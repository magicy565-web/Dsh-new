---
name: editorial-commerce-design
description: Art-direct responsive buyer magazine websites with modern editorial commerce design, category-specific visual systems, accessible components, and conversion-focused interaction.
---

# Editorial Commerce Design Skill

## Design objective
Create an editorial publication with the authority of a specialist trade journal and the usability of a modern product discovery experience. Do not produce a generic SaaS dashboard, template marketplace, brochure grid, or decorative magazine mockup.

## Art direction process
1. Derive the visual direction from product category, materials, buyer audience, brand identity, and available photography.
2. Choose one coherent art direction (palette, type system, grid, image treatment, motion language) and document why it fits.
3. Build a reusable token layer: color, type scale, spacing, content widths, radii, borders, shadows, breakpoints, motion and focus states.
4. Compose page-specific layouts from editorial modules. Reuse design tokens, not identical page layouts.
5. Keep product imagery dominant and accurate. Do not crop out important product details or use unrelated stock imagery as supplier proof.
6. Ensure the page remains excellent on narrow mobile screens and with reduced motion.

## Editorial modules
- Cover / hero with a clear editorial proposition.
- Editor's note and issue context.
- Product story with real image gallery and captions.
- Buyer specification panel with units and unknown fields.
- Process / material / capability feature.
- Comparison table with explicit criteria and caveats.
- Supplier profile with sourced facts.
- Evidence / source notes.
- FAQ and next-step CTA.
- AI sourcing assistant launcher and contextual panel.

## Interaction rules
- Use meaningful filters and comparisons, not decorative controls.
- Every control has a working action, keyboard support, visible focus, and empty/error/loading states.
- Mobile assistant opens as a bottom sheet; desktop assistant opens as a side panel.
- Preserve reading position when opening/closing assistant.
- Do not let assistant overlays cover primary content or the primary CTA.
- Respect prefers-reduced-motion; no autoplay audio/video.
- Provide text alternatives and accessible names for icon-only controls.

## Quality bar
- Visual hierarchy is intentional; no repeated cards for every content type.
- Typography supports long-form reading and technical data.
- Avoid excessive rounded cards, gradients, glassmorphism, giant empty hero regions, generic icon decoration, and over-animated scroll effects.
- Product specifications must remain readable and comparable on mobile.
- Test at 360px, 390px, 768px, 1024px, and 1440px widths.
