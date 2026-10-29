import { createCsrfMiddleware, createStart } from "@tanstack/react-start"

// Server functions only take same-origin requests. The Better Apps route needs no check, since it only accepts JSON,
// which browsers won't send across sites without a CORS preflight.
export const startInstance = createStart(() => ({
  requestMiddleware: [createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === "serverFn" })]
}))
