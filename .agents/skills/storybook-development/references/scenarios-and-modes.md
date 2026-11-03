# Scenarios and visual modes

Choose a story for a state reviewers need to reach reliably. Use modes for the environments in which they review that
state.

## Exercise difficult content

| Scenario                    | Good input                                                                                       | What to inspect                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Empty, one, few, many       | Empty collection, a single entry, typical design data, a realistically long list with unique IDs | Empty action, spacing, scrolling, pagination, and whether actions remain reachable  |
| Short and long content      | Two-letter name, multi-line title, long unbroken identifier                                      | Wrapping, clipping, focus outlines, and access to the complete text                 |
| Missing optional data       | Missing owner, avatar, or description using the real API representation                          | Fallback labels, alignment, accessible names                                        |
| Loading and failure         | Stable pending response, failed request, retry that can succeed                                  | Initial layout, error placement, keyboard access to recovery, and resulting content |
| Interaction and permissions | Read-only member, disabled pending action, expanded panel                                        | Actual permitted actions, focus movement, and feedback                              |

Pick the cases that exercise this component's contract. Give the page coverage for interactions between sections and put
detailed content extremes in the section that owns them.

**Bad.** A story named `ManyMembers` reuses the default two records. A visual change that hides the last rows can go
unnoticed.

**Good.** Supply enough distinct records to exercise scrolling, and include a name long enough to wrap. This excerpt is
for an isolated list that accepts members as props.

```tsx
export const ManyMembers: Story = {
  args: {
    members: Array.from({ length: 60 }, (_, index) =>
      makeMember({
        id: `member-${index + 1}`,
        name: index === 0 ? "Alexandria Hernández-Watanabe" : `Member ${index + 1}`
      })
    )
  }
}
```

## Use one story across viewport sizes and themes

**Bad.** Exporting `EmptyMobile`, `EmptyDesktop`, `EmptyDark`, and `EmptyLight` multiplies maintenance. One copy
eventually gets different data or different markup.

**Good.** Export `Empty` once with an empty collection. Set the preview's viewport control and theme toggle for manual
review. Configure the project's visual runner to capture that same story under each supported combination. For example,
one empty-list story can produce narrow/light, narrow/dark, wide/light, and wide/dark captures. Ensure the theme control
changes the production UI provider as well as the preview background.

Never use separate story exports for screen size or theme. A genuine product state such as an open navigation drawer can
have a story regardless of which viewport makes it easiest to see. Keep its name and setup about the drawer state. Use
relevant locale or reduced-motion settings as preview modes where supported.

## Choose the review surface

**Bad.** Wait an arbitrary interval and capture a loading story while its response races the screenshot. Or attach a
`play` function to each visual example just to assert it renders.

**Good.** Give each visual capture deterministic data and a stable point to inspect. Fix time-dependent fixture values,
wait for actual readiness where necessary, and use a controlled pending response for a loading capture. Use the existing
visual setup for fonts, animations, viewport, and theme. A static `Empty` story can support design review and visual
regression with args alone.

When the question is whether retry recovers, start from a failed request and exercise the real Retry action in a `play`
function. Follow the test-quality skill for interaction design, assertions, and avoiding redundant coverage. Review
keyboard use, focus, accessible names, and any clipped content in the same scenarios.
