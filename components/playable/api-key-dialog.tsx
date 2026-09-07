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
        throw new Error(body?.reason || body?.error || 'API Key 验证失败')
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
      <DialogContent showCloseButton={false} aria-describedby="api-key-description">
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
