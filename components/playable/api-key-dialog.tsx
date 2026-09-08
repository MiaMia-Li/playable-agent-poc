'use client'

import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ApiKeyDialogProps {
  open: boolean
  onConfigured: () => void
  onOpenChange?: (open: boolean) => void
}

const apiKeyErrorMessages: Record<string, string> = {
  invalid: 'API Key 无效，请检查后重试',
  model_access: '该 API Key 无法访问当前模型',
  quota: 'API 账户额度不足，请检查用量与账单设置',
  rate_limited: '请求过于频繁，请稍后重试',
  invalid_request: 'OpenAI 拒绝了验证请求，请稍后重试',
  provider_unavailable: 'OpenAI 服务暂时不可用，请稍后重试',
  network: '服务器无法连接 OpenAI，请检查网络或代理设置',
}

export function ApiKeyDialog({ open, onConfigured, onOpenChange }: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!apiKey) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/session/openai-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string; error?: string } | null
        throw new Error((body?.reason && apiKeyErrorMessages[body.reason]) || body?.error || 'API Key 验证失败')
      }
      onConfigured()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'API Key 验证失败')
    } finally {
      setApiKey('')
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="api-key-description">
        <DialogHeader>
          <div className="bg-primary/10 text-primary mb-1 flex size-10 items-center justify-center rounded-xl">
            <ShieldCheck aria-hidden="true" />
          </div>
          <DialogTitle>配置 OpenAI API Key</DialogTitle>
          <DialogDescription id="api-key-description">
            Key 仅用于当前加密会话，不会写入浏览器存储、全局状态或分析事件。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="playable-openai-key">OpenAI API Key</Label>
            <Input
              id="playable-openai-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              disabled={submitting}
              aria-invalid={Boolean(error)}
            />
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)} disabled={submitting}>
              暂不配置
            </Button>
            <Button type="submit" disabled={!apiKey || submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              验证并继续
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
