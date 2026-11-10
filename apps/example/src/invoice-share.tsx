import { useLinks, useShortLinks, type ShortLink } from "@better-apps/short-links/react"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Switch,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@buildkitgg/shadcn-baseui-kit"
import { CopyIcon, Share2Icon, Trash2Icon } from "lucide-react"
import { useId, useState } from "react"
import { formatTime, plural } from "./format"
import { modals } from "./ui"

/** What a failed call says, for a toast. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Try again in a moment.")

/**
 * The invoice's short links, in a dialog: make one, optionally for anyone who has it, copy it, turn it off or on, and
 * delete it. Each shows how often it was opened.
 */
export function ShareInvoice({ invoiceId, number }: { invoiceId: string; number: string }) {
  const subject = { subjectType: "invoice", subjectId: invoiceId } as const
  const { links, state, error, cursor, loadMore, client } = useLinks(subject)
  const [anyone, setAnyone] = useState(false)
  const [busy, setBusy] = useState(false)
  // The switch is a span, which a label's `for` can't name, so it points at its label and description.
  const anyoneId = useId()

  async function create() {
    setBusy(true)
    try {
      const link = await client.create({ target: subject, grantsView: anyone })
      // A new link always has an address, since it's made where a host opens it.
      if (link.shortUrl !== null) {
        await copy(link.shortUrl)
      }
    } catch (caught) {
      toast.add({ title: "The link couldn’t be created", description: messageOf(caught) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <Share2Icon />
        Share
      </DialogTrigger>
      <DialogContent className="share-dialog">
        <DialogHeader>
          <DialogTitle>Share {number}</DialogTitle>
          <DialogDescription>Short links open this invoice. Turn one off or delete it at any time.</DialogDescription>
        </DialogHeader>
        <div className="share-create">
          <Field orientation="horizontal">
            <Switch
              checked={anyone}
              onCheckedChange={setAnyone}
              aria-labelledby={`${anyoneId}-label`}
              aria-describedby={`${anyoneId}-description`}
            />
            <FieldContent>
              <FieldLabel id={`${anyoneId}-label`} onClick={() => setAnyone(!anyone)}>
                Anyone with the link can view
              </FieldLabel>
              <FieldDescription id={`${anyoneId}-description`}>
                Otherwise, people sign in to see the invoice.
              </FieldDescription>
            </FieldContent>
          </Field>
          <Button aria-disabled={busy} onClick={() => !busy && void create()}>
            Create link
          </Button>
        </div>
        <section aria-label="Links to this invoice">
          {state === "error" && <p className="form-error">Links couldn’t load. {error?.message}</p>}
          {state === "ready" && links.length === 0 && <p className="muted">No links yet.</p>}
          <ItemGroup className="share-links">
            {links.map((link) => (
              <LinkRow key={link.id} link={link} />
            ))}
          </ItemGroup>
          {cursor && (
            <Button variant="ghost" onClick={() => void loadMore()}>
              Show more links
            </Button>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}

/**
 * What a link is called: its address, or its code while it has none. Short links leave an organization's link on its
 * domain without an address while no domain of the organization is ready, which this app, with no organizations, never
 * makes.
 */
function nameOf(link: ShortLink) {
  return link.shortUrl ?? `Link ${link.code}`
}

/** Copies a link's address and says so. */
async function copy(address: string) {
  try {
    await navigator.clipboard.writeText(address)
    toast.add({ title: "Link copied", description: address, timeout: 3000 })
  } catch {
    toast.add({ title: "The link couldn’t be copied", description: address })
  }
}

/** Who a link lets in, or that it's off or has no domain to open on, and how often it was opened. */
function describe(link: ShortLink) {
  let access = "People sign in to view"
  if (link.shortUrl === null) {
    access = "Doesn’t open until the workspace domain is ready"
  } else if (!link.enabled) {
    access = "Off, so it doesn’t open"
  } else if (link.grantsView) {
    access = "Anyone with the link can view"
  }
  const opened =
    link.clicks === 0
      ? "Not opened yet"
      : `Opened ${plural(link.clicks, "time", "times")}, last ${formatTime(link.lastClickedAt ?? link.createdAt)}`
  return `${access}. ${opened}.`
}

/** One link: its address, who it lets in, how often it was opened, and what can be done to it. */
function LinkRow({ link }: { link: ShortLink }) {
  const client = useShortLinks()
  const address = link.shortUrl

  async function setEnabled(enabled: boolean) {
    try {
      await client.update({ id: link.id, enabled })
    } catch (caught) {
      toast.add({ title: "The link couldn’t be changed", description: messageOf(caught) })
    }
  }

  async function remove() {
    const confirmed = await modals.confirm({
      title: "Delete this link?",
      description: `${nameOf(link)} will stop working for everyone who has it.`,
      confirmLabel: "Delete link"
    })
    if (!confirmed) {
      return
    }
    try {
      await client.remove(link.id)
    } catch (caught) {
      toast.add({ title: "The link couldn’t be deleted", description: messageOf(caught) })
    }
  }

  return (
    <Item variant="outline" size="sm" className={link.enabled ? undefined : "link-off"}>
      <ItemContent>
        <ItemTitle className="link-address">{nameOf(link)}</ItemTitle>
        <ItemDescription>{describe(link)}</ItemDescription>
      </ItemContent>
      <ItemActions>
        {address !== null && (
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon" aria-label={`Copy ${address}`} />}
              onClick={() => void copy(address)}
            >
              <CopyIcon />
            </TooltipTrigger>
            <TooltipContent>Copy link</TooltipContent>
          </Tooltip>
        )}
        <Field orientation="horizontal" className="link-toggle">
          <Switch
            checked={link.enabled}
            onCheckedChange={(enabled) => void setEnabled(enabled)}
            aria-label={link.shortUrl === null ? nameOf(link) : `Link ${link.shortUrl}`}
          />
          {/* The switch announces its own state, so the words that show it are for sighted people only. */}
          <FieldLabel aria-hidden="true" onClick={() => void setEnabled(!link.enabled)}>
            {link.enabled ? "On" : "Off"}
          </FieldLabel>
        </Field>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon" aria-label={`Delete ${nameOf(link)}`} />}
            onClick={() => void remove()}
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipContent>Delete link</TooltipContent>
        </Tooltip>
      </ItemActions>
    </Item>
  )
}
