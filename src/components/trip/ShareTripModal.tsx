import { useState } from 'react'
import { Check, Copy, Link2, Shield, Trash2, UserPlus } from 'lucide-react'
import { useUsers } from 'deepspace'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  ConfirmModal,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@/components/ui'
import { callTripAction } from '@/lib/actions-client'
import type { TeamMemberData } from '@/lib/trip-types'

interface ShareTripModalProps {
  open: boolean
  onClose: () => void
  tripId: string
  tripTitle: string
  ownerId: string
  members: Array<TeamMemberData & { id: string }>
}

const ROLE_ITEMS: Record<'viewer' | 'editor', string> = {
  viewer: 'Viewer (Read-only)',
  editor: 'Editor (Can edit)',
}

export function ShareTripModal({
  open,
  onClose,
  tripId,
  tripTitle,
  ownerId,
  members,
}: ShareTripModalProps) {
  const { success, error } = useToast()
  const { users } = useUsers()

  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor'>('viewer')
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [inviting, setInviting] = useState(false)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [creatingLink, setCreatingLink] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<(TeamMemberData & { id: string }) | null>(null)
  const [removing, setRemoving] = useState(false)

  const existingMemberIds = new Set(members.map((m) => m.userId))
  const directoryCandidates = users.filter(
    (u) => u.id !== ownerId && !existingMemberIds.has(u.id),
  )
  const directoryItems = Object.fromEntries(
    directoryCandidates.map((u) => [u.id, u.name || u.id]),
  )

  async function handleInviteByEmail() {
    if (!email.trim() && !selectedUserId) {
      error('Enter an email or pick a user', 'Choose who to invite to this trip.')
      return
    }
    setInviting(true)
    try {
      const res = await callTripAction<{
        status: 'added' | 'link_created'
        token?: string
        role: 'viewer' | 'editor'
      }>('inviteTripMember', {
        tripId,
        email: email.trim() || undefined,
        targetUserId: selectedUserId || undefined,
        role: inviteRole,
      })

      if (res.status === 'added') {
        success(
          'Collaborator added',
          `Granted ${res.role} access to "${tripTitle}".`,
        )
        setEmail('')
        setSelectedUserId('')
      } else if (res.token) {
        const url = `${window.location.origin}/trips/${tripId}?invite=${encodeURIComponent(res.token)}`
        setLinkUrl(url)
        success(
          'Invite link created',
          'That email has not signed into Trippie yet — share this invite link.',
        )
      }
    } catch (err) {
      error('Invite failed', err instanceof Error ? err.message : 'Could not invite user')
    } finally {
      setInviting(false)
    }
  }

  async function handleCreateShareLink() {
    setCreatingLink(true)
    try {
      const res = await callTripAction<{ token: string; role: 'viewer' | 'editor' }>(
        'createTripInviteLink',
        { tripId, role: inviteRole },
      )
      const url = `${window.location.origin}/trips/${tripId}?invite=${encodeURIComponent(res.token)}`
      setLinkUrl(url)
      success('Share link ready', `Anyone accepting this link joins as ${res.role}.`)
    } catch (err) {
      error('Could not create link', err instanceof Error ? err.message : 'Failed')
    } finally {
      setCreatingLink(false)
    }
  }

  async function handleChangeRole(targetUserId: string, role: 'viewer' | 'editor') {
    try {
      await callTripAction('setTripMemberRole', { tripId, targetUserId, role })
      success('Permissions updated', `Updated collaborator to ${role}.`)
    } catch (err) {
      error('Update failed', err instanceof Error ? err.message : 'Failed')
    }
  }

  async function handleConfirmRemove() {
    if (!removeTarget) return
    setRemoving(true)
    try {
      await callTripAction('removeTripMember', {
        tripId,
        targetUserId: removeTarget.userId,
      })
      success('Access revoked', `Removed ${removeTarget.displayName || 'collaborator'}.`)
      setRemoveTarget(null)
    } catch (err) {
      error('Could not remove member', err instanceof Error ? err.message : 'Failed')
    } finally {
      setRemoving(false)
    }
  }

  function copyLink() {
    if (!linkUrl) return
    void navigator.clipboard?.writeText(linkUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <>
      <Modal open={open} onClose={onClose}>
        <Modal.Header>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-primary" aria-hidden />
            <h3 className="text-base font-semibold text-foreground">
              Share &amp; Permissions — {tripTitle}
            </h3>
          </div>
        </Modal.Header>

        <Modal.Body className="space-y-5">
          {/* Invite Section */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="invite-email">Invite by email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (e.target.value) setSelectedUserId('')
                  }}
                  placeholder="friend@example.com"
                />
              </div>
              <div>
                <Label>Permission level</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) => v && setInviteRole(v as 'viewer' | 'editor')}
                  items={ROLE_ITEMS}
                >
                  <SelectTrigger className="w-full" data-testid="invite-role-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer (Read-only)</SelectItem>
                    <SelectItem value="editor">Editor (Can edit)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {directoryCandidates.length > 0 && (
              <div>
                <Label>Or select an existing Trippie traveler</Label>
                <Select
                  value={selectedUserId}
                  onValueChange={(v) => {
                    setSelectedUserId(v ?? '')
                    if (v) setEmail('')
                  }}
                  items={directoryItems}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose traveler..." />
                  </SelectTrigger>
                  <SelectContent>
                    {directoryCandidates.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" loading={inviting} onClick={handleInviteByEmail}>
                <UserPlus className="size-3.5" aria-hidden />
                Send Invite
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={creatingLink}
                onClick={handleCreateShareLink}
                data-testid="create-invite-link-btn"
              >
                <Link2 className="size-3.5" aria-hidden />
                Create {inviteRole === 'editor' ? 'Editor' : 'Viewer'} Link
              </Button>
            </div>

            {linkUrl && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
                <Input value={linkUrl} readOnly className="h-8 text-xs font-mono" />
                <Button size="sm" variant="secondary" onClick={copyLink}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
          </div>

          {/* Current Members */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Collaborators ({members.length})
            </h4>
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {members.map((member) => {
                const isOwner = member.userId === ownerId || member.role === 'owner'
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar className="size-7">
                        <AvatarImage src={member.imageUrl} referrerPolicy="no-referrer" />
                        <AvatarFallback className="text-[11px]">
                          {(member.displayName?.[0] ?? 'T').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-sm font-medium text-foreground">
                        {member.displayName || member.userId}
                      </span>
                    </div>

                    {isOwner ? (
                      <Badge>Owner</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Select
                          value={member.role === 'editor' ? 'editor' : 'viewer'}
                          onValueChange={(v) => {
                            if (v === 'viewer' || v === 'editor') {
                              void handleChangeRole(member.userId, v)
                            }
                          }}
                          items={ROLE_ITEMS}
                        >
                          <SelectTrigger className="h-8 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="viewer">Viewer (Read-only)</SelectItem>
                            <SelectItem value="editor">Editor (Can edit)</SelectItem>
                          </SelectContent>
                        </Select>

                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${member.displayName || 'collaborator'}`}
                          onClick={() => setRemoveTarget(member)}
                        >
                          <Trash2 className="size-3.5 text-destructive" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemove}
        title={`Revoke access for ${removeTarget?.displayName || 'this collaborator'}?`}
        description="They will immediately lose access to view or edit this trip."
        confirmText="Revoke access"
        variant="destructive"
        loading={removing}
      />
    </>
  )
}
