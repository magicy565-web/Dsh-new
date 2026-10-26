# Editorial Commerce & Conversion Patterns

Luxury and editorial websites still need to drive commercial outcomes (direct purchases, B2B RFQs, lead capture, or spec downloads). Never drop a generic bright-blue "Buy Now" button or a standard Bootstrap form into an editorial spread. Use these four conversion-preserving patterns instead.

---

## Pattern 1: Museum Exhibition Plaque & Slide-Over Archive Drawer

Instead of rendering product cards with star ratings, strikethrough prices, and "Add to Cart" buttons beneath every photo, treat each product or case study as a numbered exhibition plate (`PLATE I`, `PLATE II`):

1. **On-Spread Trigger (The Museum Plaque)**:
   - Place a compact archival caption below or beside the photograph:
     `PLATE I — PERCY COMPANION AUTOMATON · SPECIMEN 1.8 KG · [ ACQUIRE / DOSSIER -> ]`
   - Hovering the plaque subtly underlines the title and reveals key telemetry (dimensions, material origin, or lead time).

2. **Slide-Over Archive Drawer (The Checkout / Spec Sheet)**:
   - Clicking any plate opens a high-contrast slide-over drawer (`max-width: 520px`) styled like an auction house lot sheet or museum loan card.
   - Include inside the drawer:
     - Full archival specification table (materials, dimensions, MOQ or unit price, lead time).
     - Interactive configuration pills (finish, weight, colorway, or batch size) with `0px` sharp borders.
     - Primary conversion button styled in solid `--ink-primary` (`#141312`) with `--paper-primary` text and monospace tracking (`ACQUIRE EDITION — $139` or `REQUEST FACTORY SAMPLE`).

---

## Pattern 2: The Tear-Out Postcard / Curatorial Requisition Slip

Replace standard "Contact Us", "Book a Demo", or "Custom Order" forms with a physical insert resting on the final spread:

1. **Visual Framing**:
   - Tilt the container slightly (`transform: rotate(-1.15deg)`) over a darker secondary paper backdrop (`--paper-secondary`) so it reads as a loose card tucked inside the back cover.
   - Add a perforated top edge (`.perforated-edge-top`), a pre-printed postage stamp box in the top-right corner (`POSTAGE PAID · ARCHIVE DEPT`), and ruled handwriting lines (`border-bottom: 1px solid rgba(20,19,18,0.22)`) instead of boxed `<input>` fields.

2. **Tactile Stamp Confirmation**:
   - When the user submits the form, trigger a physical stamp or wax seal animation (`.cinnabar-wax-seal`) that presses onto the bottom-right corner of the card, assigns a unique archival serial number (e.g., `REQ-2026-8841`), and confirms the next action.

---

## Pattern 3: Translucent Vellum Anatomy & Engineering Dossier

When explaining complex craftsmanship, supply chain stages, or technical architecture:

1. **Two-Layer Inspection**:
   - Layer 1 (Base): High-resolution studio photography or darkroom collage showing the physical object in context.
   - Layer 2 (Toggleable Vellum Sheet): A frosted semi-transparent overlay (`.vellum-tracing-overlay`) with SVG callout lines, dimension arrows, and engineering notes.
   - Provide a prominent toggle pill (`[ PEEL VELLUM BLUEPRINT ]` / `[ OVERLAY VELLUM BLUEPRINT ]`) so buyers or decision-makers can inspect both emotional aesthetics and hard technical specifications on the same spread.

---

## Pattern 4: The Sensory Centerfold Apparatus

Every memorable issue needs one interactive centerfold that lets the user experience the product's core metric directly in the browser:

- **Audio / Acoustic Products**: A rotating vinyl record or oscilloscope powered by the native Web Audio API with real-time frequency sliders and canvas waveform rendering.
- **Tactile / Physical Goods**: An interactive weight-and-pressure prescription scale or material macro loupe (`3.5x` optical zoom lens following the cursor).
- **B2B / Supply Chain / SaaS Platforms**: An interactive C2M unit-economics calculator or lead-time simulator formatted like a Financial Times / Monocle rotary slide rule, updating margin and delivery timelines in real time.
