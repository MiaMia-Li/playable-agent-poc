import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel'
import type { PlayableSandbox } from './sandbox-runner'

const execFileAsync = promisify(execFile)
const MAX_ANALYSIS_FRAMES = 20

export interface VideoFrame {
  timestampSeconds: number
  mimeType: 'image/jpeg'
  bytes: Uint8Array
}

export interface PreprocessedVideo {
  durationSeconds: number
  sampleRate: number
  frames: VideoFrame[]
}

export interface VideoPreprocessor {
  preprocess(input: {
    taskId: string
    video: Uint8Array
    mimeType: string
    abortSignal?: AbortSignal
  }): Promise<PreprocessedVideo>
}

function sampleRateForDuration(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1
  return Math.min(2, MAX_ANALYSIS_FRAMES / durationSeconds)
}

function parseDuration(value: string): number {
  const duration = Number(value.trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video duration could not be read')
  return duration
}

function extensionForMimeType(mimeType: string): string {
  return mimeType === 'video/webm' ? 'webm' : 'mp4'
}

export class LocalFfmpegVideoPreprocessor implements VideoPreprocessor {
  async preprocess(input: {
    video: Uint8Array
    mimeType: string
    abortSignal?: AbortSignal
  }): Promise<PreprocessedVideo> {
    input.abortSignal?.throwIfAborted()
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'qdai-video-'))
    const videoPath = path.join(workspace, `reference.${extensionForMimeType(input.mimeType)}`)
    try {
      await writeFile(videoPath, input.video)
      const metadata = await execFileAsync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath],
        { signal: input.abortSignal },
      )
      const durationSeconds = parseDuration(metadata.stdout)
      const sampleRate = sampleRateForDuration(durationSeconds)
      await execFileAsync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          videoPath,
          '-vf',
          `fps=${sampleRate},scale=640:-2`,
          '-frames:v',
          String(MAX_ANALYSIS_FRAMES),
          path.join(workspace, 'frame-%03d.jpg'),
        ],
        { signal: input.abortSignal },
      )
      const frames: VideoFrame[] = []
      for (let index = 1; index <= MAX_ANALYSIS_FRAMES; index += 1) {
        try {
          const bytes = await readFile(path.join(workspace, `frame-${String(index).padStart(3, '0')}.jpg`))
          frames.push({ timestampSeconds: (index - 1) / sampleRate, mimeType: 'image/jpeg', bytes })
        } catch {
          break
        }
      }
      if (frames.length === 0) throw new Error('Video frames could not be extracted')
      return { durationSeconds, sampleRate, frames }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }
}

async function createAnalysisSandbox(taskId: string, abortSignal?: AbortSignal): Promise<PlayableSandbox> {
  const explicitCredentials =
    process.env.SANDBOX_VERCEL_TOKEN && process.env.SANDBOX_VERCEL_TEAM_ID && process.env.SANDBOX_VERCEL_PROJECT_ID
      ? {
          token: process.env.SANDBOX_VERCEL_TOKEN,
          teamId: process.env.SANDBOX_VERCEL_TEAM_ID,
          projectId: process.env.SANDBOX_VERCEL_PROJECT_ID,
        }
      : {}
  const provider = createVercelSandbox({
    runtime: 'node24',
    ports: [4000],
    timeout: 10 * 60 * 1000,
    ...explicitCredentials,
  })
  return provider.createSession({ sessionId: `video-analysis-${taskId}`, abortSignal })
}

export class SandboxFfmpegVideoPreprocessor implements VideoPreprocessor {
  async preprocess(input: {
    taskId: string
    video: Uint8Array
    mimeType: string
    abortSignal?: AbortSignal
  }): Promise<PreprocessedVideo> {
    input.abortSignal?.throwIfAborted()
    const sandbox = await createAnalysisSandbox(input.taskId, input.abortSignal)
    const root = sandbox.defaultWorkingDirectory
    const videoPath = path.posix.join(root, `reference.${extensionForMimeType(input.mimeType)}`)
    try {
      await sandbox.writeBinaryFile({ path: videoPath, content: input.video, abortSignal: input.abortSignal })
      const available = await sandbox.run({
        command: 'command -v ffmpeg',
        workingDirectory: root,
        abortSignal: input.abortSignal,
      })
      if (available.exitCode !== 0) {
        const installed = await sandbox.run({
          command: 'sudo dnf install -y ffmpeg-free',
          workingDirectory: root,
          abortSignal: input.abortSignal,
        })
        if (installed.exitCode !== 0) throw new Error('Video preprocessing dependency is unavailable')
      }
      const metadata = await sandbox.run({
        command: 'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 reference.mp4',
        workingDirectory: root,
        abortSignal: input.abortSignal,
      })
      if (metadata.exitCode !== 0) {
        const webmMetadata = await sandbox.run({
          command:
            'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 reference.webm',
          workingDirectory: root,
          abortSignal: input.abortSignal,
        })
        if (webmMetadata.exitCode !== 0) throw new Error('Video duration could not be read')
        metadata.stdout = webmMetadata.stdout
      }
      const durationSeconds = parseDuration(metadata.stdout)
      const sampleRate = sampleRateForDuration(durationSeconds)
      const command = `ffmpeg -hide_banner -loglevel error -i reference.${extensionForMimeType(input.mimeType)} -vf "fps=${sampleRate},scale=640:-2" -frames:v ${MAX_ANALYSIS_FRAMES} frame-%03d.jpg`
      const extracted = await sandbox.run({ command, workingDirectory: root, abortSignal: input.abortSignal })
      if (extracted.exitCode !== 0) throw new Error('Video frames could not be extracted')
      const frames: VideoFrame[] = []
      for (let index = 1; index <= MAX_ANALYSIS_FRAMES; index += 1) {
        const bytes = await sandbox.readBinaryFile({
          path: path.posix.join(root, `frame-${String(index).padStart(3, '0')}.jpg`),
          abortSignal: input.abortSignal,
        })
        if (!bytes) break
        frames.push({ timestampSeconds: (index - 1) / sampleRate, mimeType: 'image/jpeg', bytes })
      }
      if (frames.length === 0) throw new Error('Video frames could not be extracted')
      return { durationSeconds, sampleRate, frames }
    } finally {
      await sandbox.destroy()
    }
  }
}
