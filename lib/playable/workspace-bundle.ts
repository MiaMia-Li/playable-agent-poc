import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { PlayableHostCheckError } from './host-check-error'
import type { PlayableSandbox } from './sandbox-runner'

export interface WorkspaceFile {
  relativePath: string
  content: Uint8Array
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** 将多文件合为一次传输；解包器只接受宿主生成的相对路径，不依赖额外的归档工具。 */
export async function uploadWorkspaceBundle(
  sandbox: PlayableSandbox,
  files: WorkspaceFile[],
  abortSignal?: AbortSignal,
) {
  const archive = gzipSync(
    JSON.stringify(
      files.map((file) => ({ path: file.relativePath, data: Buffer.from(file.content).toString('base64') })),
    ),
  )
  await sandbox.writeBinaryFile({
    path: `${sandbox.defaultWorkingDirectory}/skill-bundle.gz`,
    content: archive,
    abortSignal,
  })
  const script = `const fs=require('node:fs'),p=require('node:path'),z=require('node:zlib');
const root=p.resolve('skill-master');fs.mkdirSync(root,{recursive:true});
for(const file of JSON.parse(z.gunzipSync(fs.readFileSync('skill-bundle.gz')))){
 const dest=p.resolve(root,file.path);if(!dest.startsWith(root+p.sep))throw Error('Invalid bundle path');
 fs.mkdirSync(p.dirname(dest),{recursive:true});fs.writeFileSync(dest,Buffer.from(file.data,'base64'));
}fs.unlinkSync('skill-bundle.gz');`
  const result = await sandbox.run({
    command: `node -e ${quote(script)}`,
    workingDirectory: sandbox.defaultWorkingDirectory,
    abortSignal,
  })
  if (result.exitCode !== 0) throw new Error('Failed to unpack playable workspace')
}

/** 哈希基准保留在宿主，避免 Agent 同时改写文件与校验清单；一次远程命令校验全部文件。 */
export async function verifyWorkspaceMaster(
  sandbox: PlayableSandbox,
  files: WorkspaceFile[],
  abortSignal?: AbortSignal,
) {
  const expected = Buffer.from(JSON.stringify(files.map((file) => [file.relativePath, hash(file.content)]))).toString(
    'base64',
  )
  const script = `const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');
for(const [name,digest] of JSON.parse(Buffer.from(process.env.PLAYABLE_MASTER_HASHES,'base64'))){
 const file=p.join('skill-master',name);if(!fs.lstatSync(file).isFile()||c.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==digest)process.exit(1);
}`
  const result = await sandbox.run({
    command: `node -e ${quote(script)}`,
    workingDirectory: sandbox.defaultWorkingDirectory,
    env: { PLAYABLE_MASTER_HASHES: expected },
    abortSignal,
  })
  if (result.exitCode !== 0) throw new PlayableHostCheckError('Skill master was modified', 'master_modified')
}
