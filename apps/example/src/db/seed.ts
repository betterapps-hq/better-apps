import type { Invoice, InvoiceLine, InvoiceStatus } from "./schema"

interface Customer {
  name: string
  email: string
  address: string
}

const customers = {
  harbor: {
    name: "Harbor Light Bakery",
    email: "accounts@harborlight.example",
    address: "14 Wharf Street\nPortland, ME 04101"
  },
  juniper: {
    name: "Juniper Design Studio",
    email: "billing@juniper.example",
    address: "220 Alder Avenue, Suite 4\nAustin, TX 78701"
  },
  maple: {
    name: "Maple Street Clinic",
    email: "finance@maplestreet.example",
    address: "88 Maple Street\nMadison, WI 53703"
  },
  orbit: {
    name: "Orbit Freight",
    email: "ap@orbitfreight.example",
    address: "Hafenstraße 12\n20457 Hamburg\nGermany"
  },
  tidewater: {
    name: "Tidewater Books",
    email: "orders@tidewater.example",
    address: "5 Pier Road\nCharleston, SC 29401"
  },
  northwind: {
    name: "Northwind Outfitters",
    email: "payables@northwind.example",
    address: "1900 Summit Boulevard\nDenver, CO 80202"
  },
  bluebird: {
    name: "Bluebird Coffee Roasters",
    email: "hello@bluebird.example",
    address: "61 Mercer Street\nSeattle, WA 98109"
  },
  quarry: {
    name: "Quarry Hill Architects",
    email: "office@quarryhill.example",
    address: "300 Granite Way\nProvidence, RI 02903"
  }
} satisfies Record<string, Customer>

type Line = [description: string, quantity: number, unitAmount: number]

interface Spec {
  number: number
  customer: keyof typeof customers
  status: InvoiceStatus
  issuedOn: string
  dueOn: string
  paidOn?: string
  currency?: string
  taxRate?: number
  notes?: string
  lines: Line[]
}

const terms = "Payment is due within 30 days. Bank transfer details are on the attached remittance slip."

const specs: Spec[] = [
  {
    number: 1001,
    customer: "harbor",
    status: "paid",
    issuedOn: "2026-08-04",
    dueOn: "2026-09-03",
    paidOn: "2026-08-29",
    taxRate: 550,
    lines: [
      ["Storefront signage design", 1, 64_000],
      ["Menu board illustrations", 4, 12_500],
      ["Print-ready file preparation", 2, 7_000]
    ]
  },
  {
    number: 1002,
    customer: "juniper",
    status: "overdue",
    issuedOn: "2026-08-21",
    dueOn: "2026-09-20",
    taxRate: 825,
    notes: "Includes the extra round of revisions agreed on August 14.",
    lines: [
      ["Brand strategy workshop", 1, 180_000],
      ["Visual identity system", 1, 210_000],
      ["Additional revision round", 2, 10_000]
    ]
  },
  {
    number: 1003,
    customer: "maple",
    status: "overdue",
    issuedOn: "2026-10-02",
    dueOn: "2026-11-01",
    lines: [
      ["Patient portal maintenance, October", 1, 62_500],
      ["Accessibility audit", 1, 24_925]
    ]
  },
  {
    number: 1004,
    customer: "orbit",
    status: "sent",
    issuedOn: "2026-10-15",
    dueOn: "2026-11-14",
    currency: "EUR",
    taxRate: 1900,
    notes: "Reverse charge does not apply. VAT is charged at the German standard rate.",
    lines: [
      ["Route planning dashboard", 1, 720_000],
      ["Data pipeline integration", 40, 9_500],
      ["Onboarding sessions", 3, 15_000]
    ]
  },
  {
    number: 1005,
    customer: "tidewater",
    status: "draft",
    issuedOn: "2026-10-27",
    dueOn: "2026-11-26",
    taxRate: 600,
    lines: [
      ["Online catalog setup", 1, 28_000],
      ["Product photography", 12, 1_000]
    ]
  },
  {
    number: 1006,
    customer: "northwind",
    status: "paid",
    issuedOn: "2026-09-01",
    dueOn: "2026-10-01",
    paidOn: "2026-09-24",
    taxRate: 815,
    lines: [
      ["Fall catalog layout", 48, 3_200],
      ["Cover photography direction", 1, 45_000]
    ]
  },
  {
    number: 1007,
    customer: "bluebird",
    status: "paid",
    issuedOn: "2026-09-08",
    dueOn: "2026-10-08",
    paidOn: "2026-10-06",
    taxRate: 1025,
    lines: [
      ["Packaging redesign, three blends", 3, 38_000],
      ["Label printing proofs", 1, 9_500]
    ]
  },
  {
    number: 1008,
    customer: "quarry",
    status: "overdue",
    issuedOn: "2026-09-15",
    dueOn: "2026-10-15",
    taxRate: 700,
    notes: "Second reminder sent on October 29.",
    lines: [
      ["Project website, phase two", 1, 340_000],
      ["Hosting, twelve months", 12, 4_500],
      ["Content migration", 30, 2_800]
    ]
  },
  {
    number: 1009,
    customer: "harbor",
    status: "sent",
    issuedOn: "2026-10-20",
    dueOn: "2026-11-19",
    taxRate: 550,
    lines: [
      ["Holiday campaign posters", 6, 8_500],
      ["Social media templates", 1, 22_000]
    ]
  },
  {
    number: 1010,
    customer: "maple",
    status: "paid",
    issuedOn: "2026-09-02",
    dueOn: "2026-10-02",
    paidOn: "2026-10-01",
    lines: [["Patient portal maintenance, September", 1, 62_500]]
  },
  {
    number: 1011,
    customer: "northwind",
    status: "sent",
    issuedOn: "2026-10-28",
    dueOn: "2026-11-27",
    taxRate: 815,
    lines: [
      ["Winter lookbook design", 1, 96_000],
      ["Retouching", 35, 1_800],
      ["Rush delivery", 1, 15_000]
    ]
  },
  {
    number: 1012,
    customer: "juniper",
    status: "sent",
    issuedOn: "2026-11-02",
    dueOn: "2026-12-02",
    taxRate: 825,
    lines: [
      ["Website design system", 1, 265_000],
      ["Component documentation", 20, 3_500]
    ]
  },
  {
    number: 1013,
    customer: "bluebird",
    status: "draft",
    issuedOn: "2026-11-05",
    dueOn: "2026-12-05",
    taxRate: 1025,
    lines: [
      ["Café wall mural concept", 1, 52_000],
      ["Mural installation", 3, 18_000]
    ]
  },
  {
    number: 1014,
    customer: "quarry",
    status: "draft",
    issuedOn: "2026-11-06",
    dueOn: "2026-12-06",
    taxRate: 700,
    lines: [
      ["Competition entry renderings", 5, 24_000],
      ["Presentation boards", 8, 3_500]
    ]
  },
  {
    number: 1015,
    customer: "tidewater",
    status: "paid",
    issuedOn: "2026-08-12",
    dueOn: "2026-09-11",
    paidOn: "2026-09-10",
    taxRate: 600,
    lines: [
      ["Author event posters", 10, 2_400],
      ["Newsletter template", 1, 18_000]
    ]
  }
]

/** Adds tax to a subtotal, rounded to the minor unit. */
export function withTax(subtotal: number, taxRate: number) {
  return subtotal + Math.round((subtotal * taxRate) / 10_000)
}

/** The sample invoices the app adds on start, with what each bills for. */
export const seedInvoices: Invoice[] = specs.map((spec) => {
  const customer = customers[spec.customer]
  const subtotal = spec.lines.reduce((sum, [, quantity, unitAmount]) => sum + quantity * unitAmount, 0)
  const taxRate = spec.taxRate ?? 0
  return {
    id: `inv-${spec.number}`,
    number: `INV-${spec.number}`,
    customer: customer.name,
    customerEmail: customer.email,
    customerAddress: customer.address,
    amount: withTax(subtotal, taxRate),
    currency: spec.currency ?? "USD",
    taxRate,
    status: spec.status,
    issuedOn: spec.issuedOn,
    dueOn: spec.dueOn,
    paidOn: spec.paidOn ?? null,
    notes: spec.notes ?? terms
  }
})

export const seedInvoiceLines: InvoiceLine[] = specs.flatMap((spec) =>
  spec.lines.map(([description, quantity, unitAmount], position) => ({
    id: `inv-${spec.number}-${position + 1}`,
    invoiceId: `inv-${spec.number}`,
    position,
    description,
    quantity,
    unitAmount
  }))
)
