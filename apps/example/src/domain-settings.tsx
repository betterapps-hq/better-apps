// The workspace's domains settings: add a subdomain or a custom domain, see the DNS records a custom domain needs and
// whether the last check found them, check again, choose the primary domain and remove domains.
import type { Domain, DomainStatus } from "@better-apps/domains/client"
import { useDomains } from "@better-apps/domains/react"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Label,
  RadioGroup,
  RadioGroupItem,
  Spinner,
  toast
} from "@buildkitgg/shadcn-baseui-kit"
import { CopyIcon, GlobeIcon, RefreshCwIcon, StarIcon, Trash2Icon } from "lucide-react"
import { useRef, useState, type FormEvent } from "react"
import { formatTime } from "./format"
import { alerts, modals } from "./ui"

const statusLabels: Record<DomainStatus, string> = { pending: "Pending", active: "Ready", failed: "Failed" }

/** The heading of the list of domains. */
const listHeadingId = "your-domains"

/** Where alerts about domain changes show, above the list. */
const alertRegion = "domains"

/** Shows why a change failed until it's dismissed or the next change succeeds. */
function reportError(title: string, error: unknown) {
  alerts.error(
    { id: "domain-write", title, body: error instanceof Error ? error.message : "Try again in a moment." },
    alertRegion
  )
}

function done(title: string) {
  alerts.dismiss("domain-write", alertRegion)
  toast.add({ title, timeout: 4000 })
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: `${what} copied`, timeout: 3000 })
  } catch {
    toast.add({ title: `Couldn’t copy the ${what}. Select it and copy it instead.`, timeout: 5000 })
  }
}

/** The page's content for a signed-in person: the form to add a domain for the owner, and the workspace's domains. */
export function DomainSettings() {
  const { domains, list, state, error, calls, reload } = useDomains()
  if (state === "loading") {
    return (
      <output className="muted domain-loading">
        <Spinner /> Loading domains
      </output>
    )
  }
  if (state === "error" || !list) {
    return (
      <Card>
        <CardContent className="stack">
          <p role="alert">{error?.message ?? "The domains couldn’t load."}</p>
          <div>
            <Button variant="outline" onClick={() => void reload().catch(() => undefined)}>
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="stack">
      {list.canManage ? (
        <AddDomain subdomainZone={list.subdomainZone} customDomains={list.customDomains} />
      ) : (
        <p className="muted">Only the workspace owner can add or change domains.</p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            {/* Focus lands here after a removal, since the removed domain's buttons are gone. */}
            <h2 id={listHeadingId} tabIndex={-1}>
              Your domains
            </h2>
          </CardTitle>
          <CardDescription>
            Links use the primary domain, or another ready domain while it isn’t ready. A domain is ready once its
            records are in place and its certificate is issued.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <GlobeIcon />
                </EmptyMedia>
                <EmptyTitle>
                  <h3>No domains yet</h3>
                </EmptyTitle>
                <EmptyDescription>
                  {list.canManage ? "Add a subdomain or a domain you own." : "The workspace owner hasn’t added any."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="domains">
              {domains.map((domain) => (
                <li key={domain.id}>
                  <DomainItem domain={domain} canManage={list.canManage} call={calls[domain.id]} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

type Kind = "subdomain" | "custom"

interface AddDomainProps {
  subdomainZone: string | null
  customDomains: boolean
}

/** Adds a subdomain of the app's zone, or a domain the workspace owns. */
function AddDomain({ subdomainZone, customDomains }: AddDomainProps) {
  const { add } = useDomains()
  const kinds: Kind[] = [
    ...(subdomainZone ? (["subdomain"] as const) : []),
    ...(customDomains ? (["custom"] as const) : [])
  ]
  const [kind, setKind] = useState<Kind>(kinds[0] ?? "custom")
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const domain = await add(kind === "subdomain" ? { kind, label: value } : { kind, hostname: value })
      setValue("")
      done(`${domain.hostname} added`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The domain couldn’t be added.")
    } finally {
      setSaving(false)
    }
  }

  const inputId = "new-domain"
  const describedBy = [`${inputId}-hint`, error ? `${inputId}-error` : null].filter(Boolean).join(" ")
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Add a domain</h2>
        </CardTitle>
        <CardDescription>A subdomain is ready at once. A domain you own needs DNS records first.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="stack" onSubmit={handleSubmit}>
          {kinds.length > 1 && (
            <FieldSet>
              <FieldLegend variant="label">Kind of domain</FieldLegend>
              <RadioGroup
                value={kind}
                onValueChange={(next) => {
                  setKind(next as Kind)
                  setError(null)
                }}
                className="domain-kinds"
              >
                <Field orientation="horizontal">
                  <RadioGroupItem value="subdomain" id="kind-subdomain" />
                  <Label htmlFor="kind-subdomain">Subdomain of {subdomainZone}</Label>
                </Field>
                <Field orientation="horizontal">
                  <RadioGroupItem value="custom" id="kind-custom" />
                  <Label htmlFor="kind-custom">Domain you own</Label>
                </Field>
              </RadioGroup>
            </FieldSet>
          )}
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={inputId}>{kind === "subdomain" ? "Subdomain" : "Domain"}</FieldLabel>
            {kind === "subdomain" ? (
              <InputGroup>
                <InputGroupInput
                  id={inputId}
                  name="label"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="acme"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={describedBy}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>.{subdomainZone}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            ) : (
              <Input
                id={inputId}
                name="hostname"
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="links.example.com"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
              />
            )}
            <FieldDescription id={`${inputId}-hint`}>
              {kind === "subdomain"
                ? "Use letters, numbers and hyphens."
                : "You’ll add DNS records where you manage the domain, and we’ll check for them."}
            </FieldDescription>
            {error && <FieldError id={`${inputId}-error`}>{error}</FieldError>}
          </Field>
          <div>
            {/* aria-disabled rather than disabled, so the button keeps focus while the domain is added. */}
            <Button type="submit" aria-disabled={saving}>
              {saving ? "Adding domain" : "Add domain"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

interface DomainItemProps {
  domain: Domain
  canManage: boolean
  call: "check" | "remove" | "primary" | undefined
}

/** One domain: its status, the records a custom domain needs, and what the owner can do with it. */
function DomainItem({ domain, canManage, call }: DomainItemProps) {
  const { check, remove, setPrimary } = useDomains()
  const { hostname } = domain
  const busy = call !== undefined
  const headingId = `domain-${domain.id}`
  // Focus moves to the heading when the button that was pressed goes away, such as Make primary once it's primary.
  const heading = useRef<HTMLHeadingElement>(null)

  async function checkNow() {
    try {
      const checked = await check(domain.id)
      done(checked.status === "active" ? `${hostname} is ready` : `Checked ${hostname}`)
    } catch (caught) {
      reportError(`${hostname} couldn’t be checked`, caught)
    }
  }

  async function makePrimary() {
    try {
      await setPrimary(domain.id)
      heading.current?.focus()
      done(`${hostname} is now the primary domain`)
    } catch (caught) {
      reportError(`${hostname} couldn’t be made primary`, caught)
    }
  }

  async function removeDomain() {
    const confirmed = await modals.confirm({
      title: `Remove ${hostname}?`,
      description: domain.primary
        ? "It’s the primary domain, so links will use another ready domain, or the app’s own address if none is ready, until you choose another."
        : "Links on it will stop working. You can add it again later.",
      confirmLabel: "Remove domain"
    })
    if (!confirmed) {
      return
    }
    try {
      await remove(domain.id)
      document.getElementById(listHeadingId)?.focus()
      done(`${hostname} removed`)
    } catch (caught) {
      reportError(`${hostname} couldn’t be removed`, caught)
    }
  }

  return (
    <article className="domain" aria-labelledby={headingId}>
      <div className="domain-head">
        <div className="domain-title">
          <h3 id={headingId} ref={heading} tabIndex={-1}>
            {hostname}
          </h3>
          <div className="domain-badges">
            <span className={`status domain-status-${domain.status}`}>{statusLabels[domain.status]}</span>
            {domain.primary && <Badge variant="secondary">Primary</Badge>}
            <span className="muted domain-kind">{domain.kind === "subdomain" ? "Subdomain" : "Your domain"}</span>
          </div>
        </div>
        {canManage && (
          <div className="domain-actions">
            {domain.kind === "custom" && (
              <Button
                variant="outline"
                size="sm"
                aria-disabled={busy}
                aria-label={`Check ${hostname} now`}
                onClick={() => !busy && void checkNow()}
              >
                {call === "check" ? <Spinner /> : <RefreshCwIcon />}
                {call === "check" ? "Checking" : "Check now"}
              </Button>
            )}
            {domain.status === "active" && !domain.primary && (
              <Button
                variant="outline"
                size="sm"
                aria-disabled={busy}
                aria-label={`Make ${hostname} primary`}
                onClick={() => !busy && void makePrimary()}
              >
                <StarIcon />
                Make primary
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-disabled={busy}
              aria-label={`Remove ${hostname}`}
              onClick={() => !busy && void removeDomain()}
            >
              <Trash2Icon />
              Remove
            </Button>
          </div>
        )}
      </div>
      {domain.error && <p className="domain-error">{domain.error}</p>}
      {domain.kind === "custom" && domain.status !== "active" && domain.records.length > 0 && (
        <DnsRecords domain={domain} />
      )}
      {domain.kind === "custom" && <CheckTimes domain={domain} />}
    </article>
  )
}

const foundLabels = { true: "Found", false: "Not found yet", null: "Not checked" } as const

const purposeLabels = {
  routing: "Points the domain at us. Required.",
  ownership: "Proves you own the domain. Required.",
  prevalidation: "Lets us verify the domain before it points at us. Optional.",
  certificate: "Lets us issue the domain’s certificate."
} as const

/** The records to add at the domain's DNS provider, each with a copy button and whether the last check found it. */
function DnsRecords({ domain }: { domain: Domain }) {
  return (
    <section className="dns-records" aria-label={`DNS records for ${domain.hostname}`}>
      <p className="dns-records-intro">Add these records where you manage {domain.hostname}:</p>
      <ul>
        {domain.records.map((record) => (
          <li key={`${record.type} ${record.name} ${record.value}`} className="dns-record">
            <div className="dns-record-head">
              <span className="dns-type">{record.type}</span>
              <span className={`dns-found dns-found-${String(record.found)}`}>
                {foundLabels[String(record.found) as "true"]}
              </span>
            </div>
            <p className="muted dns-purpose">{purposeLabels[record.purpose]}</p>
            <dl>
              <RecordValue label="Name" value={record.name} what={`${record.type} record name`} />
              <RecordValue label="Value" value={record.value} what={`${record.type} record value`} />
            </dl>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RecordValue({ label, value, what }: { label: string; value: string; what: string }) {
  return (
    <div className="dns-value">
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
        <Button variant="ghost" size="icon-sm" aria-label={`Copy ${what}`} onClick={() => void copy(value, what)}>
          <CopyIcon />
        </Button>
      </dd>
    </div>
  )
}

/** When a custom domain was last checked, and when it's checked next. */
function CheckTimes({ domain }: { domain: Domain }) {
  const { lastCheckedAt, nextCheckAt } = domain
  if (!lastCheckedAt) {
    return null
  }
  return (
    <p className="muted domain-checked">
      Last checked <time dateTime={lastCheckedAt.toISOString()}>{formatTime(lastCheckedAt)}</time>.
      {nextCheckAt && (
        <>
          {" "}
          Next check around <time dateTime={nextCheckAt.toISOString()}>{formatTime(nextCheckAt)}</time>.
        </>
      )}
    </p>
  )
}
