---
name: GitLarp
description: A monochrome liquid-glass workspace for real repository improvements
colors:
  background: "#050505"
  action-ink: "#080808"
  foreground: "#f2f2f2"
  primary-white: "#f0f0f0"
  white: "#fff"
  muted: "#b4b4b4"
  subtle: "#a0a0a0"
  supporting: "#aaa"
  field: "#090909"
  field-text: "#eee"
  field-border: "#363636"
  glass: "rgba(18,18,18,.78)"
  glass-border: "rgba(255,255,255,.13)"
  sidebar-glass: "rgba(10,10,10,.87)"
  secondary-glass: "rgba(255,255,255,.055)"
  secondary-border: "#3c3c3c"
  secondary-hover: "#292929"
  repository-glass: "rgba(16,16,16,.74)"
  connection-glass: "rgba(14,14,14,.79)"
  editor-glass: "rgba(16,16,16,.78)"
  source: "#0a0a0a"
  source-text: "#e0e0e0"
  fallback: "#151515"
  selected: "#ffffff0e"
typography:
  display:
    fontFamily: "Sora Variable, sans-serif"
    fontSize: "64px"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-.035em"
  heading:
    fontFamily: "Sora Variable, sans-serif"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-.035em"
  section:
    fontFamily: "Sora Variable, sans-serif"
    fontSize: "25px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-.035em"
  body:
    fontFamily: "DM Sans Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.8
  repository-title:
    fontFamily: "DM Sans Variable, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  label:
    fontFamily: "DM Sans Variable, sans-serif"
    fontSize: "12px"
    fontWeight: 550
  button:
    fontFamily: "DM Sans Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  code:
    fontFamily: "Consolas, monospace"
    fontSize: "11px"
    lineHeight: 1.95
rounded:
  tag: "5px"
  icon: "8px"
  control: "9px"
  workbench: "12px"
  surface: "16px"
  dialog: "18px"
  connection: "18px"
spacing:
  control-gap: "9px"
  compact: "12px"
  group: "16px"
  block: "20px"
  section: "24px"
  plate: "30px"
  page-inline: "38px"
components:
  button-primary:
    backgroundColor: "{colors.primary-white}"
    textColor: "{colors.action-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.white}"
    textColor: "{colors.action-ink}"
  button-secondary:
    backgroundColor: "{colors.secondary-glass}"
    textColor: "{colors.field-text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  button-icon:
    textColor: "#bcbcbc"
    rounded: "{rounded.icon}"
    width: "36px"
    height: "36px"
  button-text:
    textColor: "{colors.white}"
    padding: "5px 0"
  text-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.field-text}"
    rounded: "{rounded.control}"
    padding: "12px"
  navigation-item:
    textColor: "#b2b2b2"
    rounded: "{rounded.control}"
    padding: "12px 10px"
  navigation-item-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.white}"
  tag:
    textColor: "#bbb"
    rounded: "{rounded.tag}"
    padding: "4px 7px"
  repository-surface:
    backgroundColor: "{colors.repository-glass}"
    rounded: "{rounded.surface}"
    padding: "22px 21px 0"
  connection-panel:
    backgroundColor: "{colors.connection-glass}"
    rounded: "{rounded.connection}"
    padding: "34px"
  file-view-button:
    textColor: "#acacac"
    rounded: "{rounded.tag}"
    padding: "6px 9px"
  file-view-button-pressed:
    backgroundColor: "#303030"
    textColor: "#dddddd"
---

# Design System: GitLarp

## Overview

**Creative North Star: "Photographic darkroom optical bench"**

Neutral black grounds a workspace of silver light, frosted charcoal plates, and white controls. The native WebGL lens supplies the optical character; precise typography and quiet borders keep repository work readable over it. This records the user's approved black-and-white replacement and the finished implementation.

Glass carries the connection, navigation, library, and supporting workbench regions. Source and original-file content have opaque dark grounds. Motion belongs to the background and loading feedback; working content stays stable.

**Key Characteristics:**

- Neutral black, white ink, and grayscale state treatments.
- Self-hosted Sora headings and DM Sans interface text.
- Refracted silver WebGL light behind restrained glass plates.
- Opaque source editing and responsive repository review.
- Pausable motion, reduced-motion handling, and static visual fallback.

## Colors

The palette remains achromatic, including account photography, repository metadata, errors, selection, and completion.

### Primary

- **Action White:** Filled primary actions; hover moves to White.
- **Action Ink:** Text on white actions and selection highlights.
- **White:** Focus outlines, bright icons, and active navigation.

### Neutral

- **Background Black:** The page ground and the field behind the silver lens.
- **White Ink:** Main text; Muted, Subtle, and Supporting gray separate supporting information.
- **Frosted Charcoal:** Glass, sidebar, connection, repository, and editor plates use different neutral alpha backgrounds.
- **Field Black:** Editable form fields, separated by Field Border.
- **Source Black:** Opaque source and original-file grounds with Source Text.
- **Fallback Charcoal:** Solid plates when CSS backdrop filtering is unavailable.

**The Monochrome State Rule.** Keep states achromatic and retain labels, icons, native controls, and borders so hue is never required to understand selection, failure, or completion.

## Typography

**Display Font:** Self-hosted Sora Variable, with sans-serif fallback.
**Body Font:** Self-hosted DM Sans Variable, with sans-serif fallback.
**Code Font:** Consolas, with monospace fallback.

Sora carries balanced headings with negative tracking. DM Sans provides compact controls, ownership paths, descriptions, and repository names. The code family is reserved for source, original files, and inline/code-block content. Font assets are imported locally in the application entry point.

### Hierarchy

- **Display:** Connection heading; the frontmatter records its desktop size. It increases to (72px) at wide screens, steps down through (52px) and (43px), and uses (44px) then (40px) on narrow screens.
- **Heading:** Library page heading; responsive overrides use (29–30px). The project heading shares the desktop size and uses (29px) on mobile.
- **Section:** Workbench headings; mobile sections use (23px). The connection heading uses (25px), and repository discovery uses (21px).
- **Body:** The frontmatter records page and connection-panel descriptions. Contextual prose uses (12–16px), with line height typically (1.7–1.9); no global body line height is declared.
- **Repository Title:** DM Sans names stay prominent within compact glass cards.
- **Label:** Form and module labels; mobile workflow, file choices, review controls, checks, and commit summaries retain (12px) task text.
- **Code:** Source and original-file panels use the recorded code scale. Narrow editable source uses (16px), as do mobile token, search, field, commit-message, and toolbar-select inputs.

Counts and timestamps use tabular numerals. Repository descriptions clamp to two lines in the library; project descriptions and ownership paths can wrap.

## Layout

The connection surface centers within (1440px), with desktop horizontal insets of (64px), a flexible purpose column, a (420px) connection plate, and an (80px) gap. Intermediate widths reduce the plate and gap. At (760px), the columns stack inside a (590px) maximum width with (25px) side insets.

The authenticated sidebar floats (16px) from the viewport edges and measures (220px), reducing to (200px) at (1200px). The main shell begins at (252px), then (232px). Its utility bar is (84px) high; content centers within (1530px) with (38px) desktop side insets. At (760px), the main margin clears, the utility bar becomes (70px), and content uses (20px) side insets. The (235px) mobile drawer is closed offscreen, inert, and hidden from assistive technology until opened; its scrim and Escape action dismiss it.

Repository discovery follows the page heading directly, with an available count and a compact search/filter toolbar. Repository cards use three columns, two at (1200px), and one at (560px). Search consumes a full toolbar row at (950px). List view changes to a two-column arrangement at the mobile breakpoint. Related controls use tight gaps, while major sections have broader vertical separation.

Configuration and publishing place evidence or destination summaries beside the task; they stack at (950px). File review uses a (247px) desktop tree, narrowing at intermediate widths. At (560px), the file list becomes a horizontal strip above the editor. Documentation navigation similarly moves above its content at (950px).

## Elevation & Depth

Translucent neutral plates, bright hairline borders, and blurred background light create depth. Reusable glass uses (22px) backdrop blur; the utility bar and repository toolbar use (18px), workbench plates (16px), and native dialogs (30px). Source and original-file content stay opaque. Browsers without backdrop filtering receive solid fallback backgrounds for the main glass, sidebar, connection plate, dialog, and utility bar.

### Shadow Vocabulary

- **Connection plate:** (`0 25px 90px #0007`) anchors authentication over the lens.
- **Toast:** (`0 12px 45px #0009`) separates transient status from work.
- **Dialog:** (`0 30px 100px #0008`) elevates the native modal; its backdrop adds dark scrim and (9px) blur.

**The Readable Plate Rule.** Keep glass on surrounding controls and containers while source and original-file content use the opaque Source Black ground.

The lens is rendered in native WebGL from neutral light values. It follows pointer position with exponential easing while playing. Drawing follows display-synchronized requestAnimationFrame ticks, with pixel density capped at (1.25) and backing width at (1600px). The shader stays initialized across pause and workspace changes; the workspace lens position and intensity ease between states. User pause and reduced motion hold it still; hidden tabs and offscreen canvases stop scheduling draws. Unsupported WebGL, shader failure, or context loss reveals the static radial-light fallback. The canvas is decorative and hidden from assistive technology.

Control transitions use (180ms); the mobile drawer uses (200ms). Buttons move down (1px) on active press; repository-name arrows move right (3px) on hover. Loading uses a (1s) rotation and (1.6s) skeleton pulse. Reduced motion disables CSS animations and transitions as well as shader movement.

## Shapes

Controls have softly rounded corners, with smaller corners for compact tags and file-view buttons. Larger glass surfaces have the Surface radius; workbench regions use the Workbench radius. The connection plate and dialog have larger, distinct radii. Mobile connection corners reduce to (17px). Most structural and control borders are (1px). Status dots, progress steps, and account controls use circular geometry.

## Components

### Buttons

White filled actions establish the next task. Secondary actions use faint white transparency with gray borders, brightening on hover. Both share compact type, the Control radius, recorded padding, and a (42px) minimum height. Contextual mobile page-heading actions use a (39px) minimum height. Disabled buttons use (0.45) opacity and a not-allowed cursor. Global focus uses a white (2px) outline with (4px) offset.

Icon buttons are compact square controls with the Icon radius and accessible names. Hover adds a faint white ground and brighter ink. Text actions remain white and underlined, with a (4px) underline offset.

### Chips

Tags and visibility badges are compact outlined metadata. They stay neutral and are static text rather than simulated buttons. Visibility labels retain their wording and lock icon where applicable.

### Cards / Containers

Repository cards place ownership, actionable name, description, metadata, and footer inside a glass plate. The name is the repository action; the whole card is not an unlabeled interactive surface. Hover brightens the border and ground. Main working, settings, history, and documentation containers share the rounded glass material.

The connection plate uses a stronger dark ground and ambient shadow to keep the authentication form readable over silver highlights.

### Inputs / Fields

Labels sit above dark fields. The field border brightens on focus, and the global focus outline remains visible. Placeholders use supporting gray; caret and selected text remain achromatic. Mobile text-entry controls use the recorded (16px) override. Token visibility is an explicitly named pressed button. Error banners announce with alert semantics and provide concrete text or retry actions.

### Navigation

The floating rail uses neutral interface type and softly outlined active rows. Current workspace destinations expose current-page semantics. The mobile trigger exposes the controlled navigation and expanded state; closing the drawer returns useful focus. Settings switches expose their checked state.

### File Review

Preview, Edit source, and Original are ordinary buttons grouped under a named file-view control, with accurate pressed states. Selected controls use a brighter neutral fill. Source editing is a labeled textarea; original content and rendered Markdown remain selectable. Copy and download actions have explicit accessible names.

The three-stage progress list retains stage labels and check icons. Existing in-memory, unexpired, unpublished drafts resume at review when their repository is reopened; do not represent them as durable browser storage.

### Project Intelligence

The workbench introduces source analysis before module selection. Keep its charcoal surface, (16px) corners, achromatic states, native inputs and familiar button styles. Source links open immutable snapshot paths. Overview, architecture and recommendation controls are a named group of ordinary buttons with accurate pressed states. Facts use readable paragraphs and source links rather than readiness scores. Separate scope, sampled files, actual provider usage and cached-analysis reuse from claims about project behavior.

Analysis body text is (13px) with (1.85) line height and a maximum (75ch) paragraph measure; local headings are (23px) on desktop and (21px) on mobile. Fact titles use (14px), question titles (15px), and local section headings (16px). Citation/tag corners use (3px), (5px), (6px) and (7px); the empty-state inset uses (10px). Secondary fact text uses (#c0c0c0), priority labels (#bbb), and quotation rules (#777), all intentional achromatic tones. The two-column capabilities/stack layout collapses below (950px). Mobile inputs use (16px). Source citations wrap, tables/code scroll inside their content area, and question answers remain selectable. Native details reveal coverage and collapse intelligence during file review. Lucide chevrons indicate expansion. AI failures announce above the panel and preserve the account and selected modules. Model calls are explicit; changing views cancels pending AI work.

### Dialogs and Feedback

Dialogs use native modal behavior and accessible names tied to their visible titles, with close controls, Escape dismissal, and the dark blurred backdrop. Toasts announce status and provide a named dismissal action. Loading, empty, unavailable authentication, failed access, and partial publishing outcomes keep real state and next actions explicit.

## Do's and Don'ts

### Do:

- **Do** keep black, white, and grayscale across controls, states, account images, and the silver lens.
- **Do** use self-hosted Sora for headings, DM Sans for interface text, and Consolas for source content.
- **Do** keep source and original-file content opaque while surrounding regions use glass.
- **Do** retain named controls, visible focus, readable mobile task labels, and 16px mobile text-entry fields.
- **Do** preserve pause, reduced motion, bounded WebGL rendering, and static fallback behavior.

### Don't:

- **Don't** restore the replaced violet accents or introduce colored state cues.
- **Don't** make visual effects necessary for any repository operation.
- **Don't** communicate selection or completion through tone alone; retain text, icons, and native control states.
- **Don't** turn static metadata tags or entire repository cards into unlabeled controls.
- **Don't** present an in-memory draft as a durable saved artifact or show publish success before a server result.
