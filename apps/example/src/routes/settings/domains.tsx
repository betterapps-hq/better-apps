import { AlertRegion } from "@buildkitgg/shadcn-alerts-manager"
import { Card, CardContent } from "@buildkitgg/shadcn-baseui-kit"
import { createFileRoute } from "@tanstack/react-router"
import { SignInPrompt } from "../../app-shell"
import { DomainSettings } from "../../domain-settings"
import { alerts } from "../../ui"
import { useViewer } from "../../viewer"

export const Route = createFileRoute("/settings/domains")({
  head: () => ({ meta: [{ title: "Domains – Better Invoices" }] }),
  component: Domains
})

function Domains() {
  const viewer = useViewer()
  return (
    <div className="narrow">
      <div className="page-head">
        <div>
          <h1>Domains</h1>
          <p>Choose where people reach your workspace, on a subdomain of ours or on a domain you own.</p>
        </div>
      </div>
      <AlertRegion manager={alerts} region="domains" label="Domain alerts" />
      {viewer ? (
        // A signed-in person's domains load in the browser, so the server render never holds them.
        <DomainSettings />
      ) : (
        <Card>
          <CardContent>
            <SignInPrompt>to see the workspace’s domains.</SignInPrompt>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
