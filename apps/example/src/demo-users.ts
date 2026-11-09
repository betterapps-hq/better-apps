/** People the example signs up on its first start, to sign in as and mention. */
export const demoUsers = [
  { name: "Ada Lovelace", email: "ada@example.com", role: "Owner" },
  { name: "Grace Hopper", email: "grace@example.com", role: "Accountant" },
  { name: "Alan Turing", email: "alan@example.com", role: "Sales" }
] as const

/** The workspace owner, who can delete anyone's comments and threads and move any pin. */
export const ownerEmail = "ada@example.com"

/** Their password. They exist only in this example's local database. */
export const demoPassword = "better-apps-example"
