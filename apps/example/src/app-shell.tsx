import { AlertRegion } from "@buildkitgg/shadcn-alerts-manager"
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  Toaster,
  TooltipProvider
} from "@buildkitgg/shadcn-baseui-kit"
import { ModalRenderer } from "@buildkitgg/shadcn-modals-manager"
import { useTheme, type Theme } from "@buildkitgg/shadcn-theme"
import { Link, useLocation, useMatch } from "@tanstack/react-router"
import {
  ChevronsUpDownIcon,
  FileTextIcon,
  LogInIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  NotebookPenIcon,
  ReceiptTextIcon,
  SunIcon
} from "lucide-react"
import { useEffect, type ReactNode } from "react"
import { alerts, modals, theme } from "./ui"
import { useViewer } from "./viewer"

/** The initials of a name, for avatars. */
export function initials(name: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}` : (words[0]?.slice(0, 2) ?? "?")).toUpperCase()
}

/** The app's frame: a sidebar with the app's sections and the signed-in person, and a header over each page. */
export function AppShell({ children }: { children: ReactNode }) {
  // Applies the saved appearance to the document, and follows the system's while that's the choice.
  useEffect(() => theme.start(), [])
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset id="main" tabIndex={-1}>
          <header className="app-header">
            <SidebarTrigger />
            <span className="app-header-divider" aria-hidden="true" />
            <Crumbs />
          </header>
          <div className="page">
            <AlertRegion manager={alerts} label="Notifications" />
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <ModalRenderer manager={modals} />
      <Toaster />
    </TooltipProvider>
  )
}

function AppSidebar() {
  const { pathname } = useLocation()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/invoices" />} tooltip="Invoices">
              <span className="brand-mark" aria-hidden="true">
                <ReceiptTextIcon size={16} />
              </span>
              <span className="brand-text">
                <strong>Better Invoices</strong>
                <span>Better Apps example</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Billing</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.startsWith("/invoices")}
                  render={<Link to="/invoices" />}
                  tooltip="Invoices"
                >
                  <FileTextIcon />
                  <span>Invoices</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={pathname === "/notes"} render={<Link to="/notes" />} tooltip="Notes">
                  <NotebookPenIcon />
                  <span>Notes</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <AccountMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

const pageNames: Record<string, string> = { "/invoices": "Invoices", "/notes": "Notes", "/sign-in": "Sign in" }

/** Where the page sits in the app, ending with the page itself. */
function Crumbs() {
  const { pathname } = useLocation()
  const invoice = useMatch({ from: "/invoices/$invoiceId", shouldThrow: false })
  const number = (invoice?.loaderData as { number?: string } | undefined)?.number
  if (invoice) {
    return (
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/invoices">Invoices</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{number ?? "Invoice"}</span>
      </nav>
    )
  }
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <span aria-current="page">{pageNames[pathname] ?? ""}</span>
    </nav>
  )
}

const themeChoices: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
  { value: "system", label: "System", icon: <MonitorIcon /> }
]

function roleOf(viewer: { isOwner: boolean } | null) {
  if (!viewer) {
    return "Sign in to comment"
  }
  return viewer.isOwner ? "Workspace owner" : "Member"
}

/** The signed-in person, with their appearance and a way to sign out, or a way to sign in. */
function AccountMenu() {
  const viewer = useViewer()
  const { href } = useLocation()
  const { theme: preference, setTheme } = useTheme(theme)

  async function signOut() {
    const response = await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }).catch(() => null)
    if (!response?.ok) {
      alerts.error({ id: "sign-out", title: "Sign-out failed", body: "Check your connection and try again." })
      return
    }
    // A full load, so nothing loaded for the signed-in person stays in the browser's stores.
    window.location.assign(href)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" aria-label={viewer ? `Account: ${viewer.name ?? "Signed in"}` : "Account"} />
            }
          >
            <Avatar size="sm">
              <AvatarFallback>{viewer ? initials(viewer.name) : <LogInIcon size={14} />}</AvatarFallback>
            </Avatar>
            <span className="brand-text">
              <strong>{viewer ? (viewer.name ?? "Signed in") : "Not signed in"}</strong>
              <span>{roleOf(viewer)}</span>
            </span>
            <ChevronsUpDownIcon className="account-chevron ms-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={preference} onValueChange={(value) => setTheme(value as Theme)}>
                {themeChoices.map((choice) => (
                  <DropdownMenuRadioItem key={choice.value} value={choice.value}>
                    {choice.icon}
                    {choice.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {viewer ? (
              <DropdownMenuItem onClick={() => void signOut()}>
                <LogOutIcon />
                Sign out
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem render={<Link to="/sign-in" search={{ redirect: href }} />}>
                <LogInIcon />
                Sign in
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** Asks a signed-out visitor to sign in for something only signed-in people see. */
export function SignInPrompt({ children }: { children: string }) {
  const { href } = useLocation()
  return (
    <div className="stack">
      <p className="muted">Sign in {children}</p>
      <div>
        <Button render={<Link to="/sign-in" search={{ redirect: href }} />} nativeButton={false}>
          <LogInIcon />
          Sign in
        </Button>
      </div>
    </div>
  )
}
