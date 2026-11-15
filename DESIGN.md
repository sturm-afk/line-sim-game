Beautify every screen of the existing MES application with a cohesive, polished visual design. The goal is a modern pharmaceutical manufacturing operations interface: professional, precise, confident, and visually engaging without looking overly corporate or cluttered.

## 1. Overall visual identity

Use a color palette inspired by deep cerulean blue, polished metal, autumnal burnt orange, clean white, and near-black.

Suggested CSS variables:

```css
:root {
  /* Primary blues */
  --color-blue-deep: #073B5C;
  --color-blue-cerulean: #007BA7;
  --color-blue-light: #DCEFF6;

  /* Metallic accents */
  --color-silver: #B8C2CC;
  --color-silver-light: #E5E9ED;

  /* Burnt orange accents */
  --color-orange: #B6531D;
  --color-orange-light: #F5E3D8;

  /* Neutral colors */
  --color-white: #FFFFFF;
  --color-background: #F4F6F8;
  --color-black: #17191C;
  --color-text-secondary: #56616B;

  /* Status colors */
  --color-success: #167A45;
  --color-success-light: #E0F2E8;
  --color-failure: #B42318;
  --color-failure-light: #FDE8E7;
  --color-warning: #A65A13;
  --color-warning-light: #FFF0D9;

  /* UI structure */
  --color-border: #D5DCE2;
  --color-card: #FFFFFF;
  --color-focus: #F0A15C;
}
```

Use deep blue for primary navigation, headers, and major interface elements. Cerulean should provide secondary emphasis and interactive accents. Burnt orange should be used selectively for important actions, highlights, and attention areas. White and near-black should provide strong contrast and readability.

Create a subtle metallic effect using restrained gradients or highlights on selected headers and decorative elements. Do not apply metallic gradients to body text, data tables, or essential controls.

## 2. Design principles

- Professional manufacturing execution system aesthetic.
- Clean layouts with consistent spacing and alignment.
- Strong visual hierarchy.
- Large, readable typography.
- Clear distinction between interactive controls and informational content.
- Rounded corners used consistently, without making the interface look playful.
- Subtle shadows and borders to establish depth.
- Responsive design for iPhone Safari, tablets, and desktop displays.
- Avoid unnecessary animation, decoration, and visual clutter.
- Maintain high contrast and accessible text sizes.
- Never communicate status through color alone.

## 3. Participant event-button screens

These screens are used by participants operating dedicated event devices.

They must be exceptionally simple and immediately understandable.

Each screen should display:

- VitaNova MES branding.
- Current team identifier.
- Current round and batch identifier.
- Clear event name.
- One large, prominent event button.
- Connection status.
- Immediate success or error feedback.
- A clear ready state.

The primary button should occupy a substantial portion of the screen and be easy to tap on an iPhone.

Use an appropriate icon alongside a clear text label:

| Event | Suggested icon | Visual treatment |
|---|---|---|
| Manufacturing complete | Factory or gear | Deep blue |
| In-process QC Pass | Checkmark in circle | Green |
| In-process QC Fail | X in circle | Red |
| Packaging complete | Package or box | Cerulean |
| Final QC Pass | Shield with checkmark | Green |
| Final QC Fail | Shield with X | Red |
| Shipping dispatched | Delivery truck or shipping box with arrow | Burnt orange |

Icons must be recognizable without relying on color. Always include descriptive text labels.

Use an established icon library if one is already installed. Otherwise, choose a lightweight, consistent icon solution rather than introducing a large dependency.

After a successful button press:
- Show a prominent confirmation checkmark.
- Display a short confirmation message, such as "Event Recorded".
- Briefly indicate the event type.
- Return to the ready state automatically.

For failed submissions:
- Show an unmistakable error icon.
- Explain what happened in plain language.
- Do not display a success state unless the server confirms persistence.

Make connection status visible but unobtrusive:
- Green indicator: Connected.
- Amber indicator: Reconnecting.
- Red indicator: Disconnected.

## 4. Shared scoreboard

Design the scoreboard for projection onto a large screen.

It should be readable from across a meeting room.

Use:
- Deep blue page background or header.
- White metric cards.
- Large, bold numeric values.
- Clear team identification.
- Subtle cerulean and burnt orange accents.
- Consistent spacing between teams and metrics.

Give Teams A, B, and C distinct visual identifiers while retaining the overall brand palette.

Display:
- Inserts manufactured.
- In-process QC Pass.
- In-process QC Fail.
- Packages assembled.
- Final QC Pass.
- Final QC Fail.
- Packages shipped.
- In-process QC yield.
- Final QC yield.

Use large typography for the most important production metrics, particularly packages shipped.

Make the current round and batch identifiers highly visible.

Ensure that the scoreboard remains readable when projected in a bright room.

## 5. Facilitator dashboard

The facilitator interface should feel like an operations control center.

Use a structured layout with:
- A strong dark-blue header.
- Clear round-management controls.
- Team performance summaries.
- Device connectivity indicators.
- Recent event activity.
- System health information.
- Export controls.

Use burnt orange sparingly to highlight important facilitator actions.

Make Start Round, End Round, and Reset controls visually distinct. Destructive or irreversible actions must require confirmation.

Use clear status badges and recognizable icons for system health and device connectivity.

## 6. Event history and reporting

Create a clean, readable event-history table.

Use:
- Strong column headings.
- Alternating subtle row backgrounds.
- Clear timestamp formatting.
- Team and batch identifiers.
- Recognizable event icons.
- Status indicators.
- Consistent alignment of numeric values.

Use the same status colors and iconography throughout the application.

Make it easy to visually distinguish manufacturing, QC, packaging, and shipping events.

## 7. Consistency across all screens

Create reusable design tokens and shared components for:
- Buttons.
- Cards.
- Headers.
- Status badges.
- Icons.
- Tables.
- Typography.
- Spacing.
- Borders and shadows.

All screens should look like parts of the same application.

Do not redesign the underlying MES workflow, event model, business rules, or data structures as part of this task.

Do not remove existing functionality or change event-processing behavior.

## 8. Accessibility and usability requirements

- Maintain WCAG 2.2 AA contrast targets wherever applicable.
- Never use color as the only indicator of Pass, Fail, Connected, or Disconnected.
- Use descriptive labels for all buttons.
- Provide visible keyboard focus states.
- Ensure touch targets are comfortably large for mobile use.
- Use readable font sizes and avoid low-contrast metallic text.
- Support iPhone Safari without horizontal scrolling on participant screens.
- Keep the participant interface usable with minimal explanation.

## 9. Implementation approach

Before making changes:
1. Inspect the existing application and identify every screen and shared component.
2. Identify the current styling framework and icon library.
3. Reuse existing dependencies where practical.
4. Establish the CSS design tokens.
5. Apply the visual system consistently across all screens.
6. Test responsive behavior on mobile and desktop.
7. Verify that all existing functionality and event workflows still work.

Do not rebuild the application or introduce unnecessary dependencies.

The finished application should look like a polished, modern pharmaceutical manufacturing operations platform—not a generic dashboard template.
