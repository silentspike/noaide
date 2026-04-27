# OpenGraph / Social Preview — design spec

GitHub renders a social-preview card whenever the noaide repo URL is
shared on LinkedIn, Slack, Discord, Twitter / X, mail, or pasted into
a chat. By default GitHub generates a 1200×600 card with the repo
name, owner, primary language, and stars. The default works, but it
says nothing about what noaide is.

This file documents the design intent for a custom social-preview
image so the choice stays consistent across regenerations.

## Constraints

| Field | Value |
|---|---|
| Format | PNG |
| Dimensions | 1280 × 640 (GitHub recommendation) |
| Max size | 1 MB (GitHub upload cap) |
| Upload | https://github.com/silentspike/noaide/settings → "Social preview" → "Edit" |
| Storage | **Never committed to the repo.** GitHub reads from repo settings, not the source tree. |

## Tone

The card is the first impression a non-engineer reviewer gets — a
recruiter looking at the repo from a Slack message, a customer-
engineering director looking at it from a LinkedIn post. The audit
direction (CC-2 customer-tone, CC-9 OpenGraph) calls for a sober
operator-console framing rather than entertainment copy.

Concrete choices:

- **No Codex highlight, no Claude highlight, no Gemini highlight.**
  The repository is tool-agnostic; the OG card has to be too. A
  card that prominently features one provider's logo reads as
  vendor-targeting when other reviewers see it. (Authenticity test:
  would the same card make sense if shared at Anthropic, Google,
  and OpenAI? If not, rework.)
- **No marketing vocabulary** — no "AI superpowers", no "next-
  generation", no exclamation marks.
- **No live screenshot of the operator's own machine.** The
  background screenshot is the seeded fixture session in noaide;
  no real Claude session, no real Codex transcript.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  noaide — Operator console for AI coding agents          │ ← title strip,
│                                                          │   ~80 px
├──────────────────────────────────────────────────────────┤
│                                                          │
│         (three-panel UI screenshot, seeded               │
│          Codex / Claude / Gemini session, neutral        │
│          chat content, no real provider replies)         │
│                                                          │
│                                                          │
│  ┌─────────┬───────────┬────────────┐                    │
│  │  Codex  │  Claude   │  Gemini    │ ← optional small    │
│  └─────────┴───────────┴────────────┘   tool-row footer   │
└──────────────────────────────────────────────────────────┘
```

The three tool labels at the bottom (Codex / Claude Code / Gemini
CLI) are equal-weight text labels, not logos. Logos in a marketing
asset invite "is this an official integration?" questions; text
labels do not.

## Generation recipe

The image is rebuildable from any 1920×1080 noaide screenshot with
ImageMagick:

```bash
SOURCE=docs/images/codex-session.png   # or any three-panel screenshot
OUT=/tmp/og/noaide-og.png

mkdir -p /tmp/og
magick "$SOURCE" -resize 1280x -gravity center -extent 1280x640 /tmp/og/og-base.png

magick /tmp/og/og-base.png \
  -fill 'rgba(30,30,46,0.92)' -draw 'rectangle 0,0 1280,80' \
  -fill '#cdd6f4' \
  -font /usr/share/fonts/truetype/LiberationSans-Bold.ttf -pointsize 30 \
  -gravity NorthWest -annotate +30+25 'noaide — Operator console for AI coding agents' \
  "$OUT"

identify "$OUT"            # expect: 1280x640
ls -lh "$OUT"              # expect: ≤ 1 MB
```

The ImageMagick recipe drops the three tool labels for the simple
case; for the full layout, append a second annotation pass at the
bottom edge:

```bash
magick "$OUT" \
  -fill 'rgba(30,30,46,0.85)' -draw 'rectangle 0,580 1280,640' \
  -fill '#cdd6f4' \
  -font /usr/share/fonts/truetype/LiberationSans-Regular.ttf -pointsize 22 \
  -gravity South -annotate +0+18 'Codex   ·   Claude Code   ·   Gemini CLI' \
  "$OUT"
```

## Anti-patterns

These have been considered and rejected:

- **A Codex-only card** — vendor-targeting, fails CC-1 authenticity
  test.
- **A "Built with AI" / "AI-powered" framing** — generic, says nothing
  the description does not already say, plus invites the AI-slop
  reflex.
- **A photo or 3D render of a control panel** — too marketing.
- **A code-snippet on dark background card** (LeetCode-style) —
  reads as personal portfolio, not as an operator-tool repo.

## When to regenerate

- After a hero rename (the title strip text must match the README
  lead sentence).
- After a UI redesign large enough that the three-panel screenshot
  no longer matches the current build (≥ minor version cut).
- Never as a "let's freshen the social preview" cosmetic exercise —
  GitHub caches OG images aggressively, and changing the card
  invalidates all the existing previews on shared links.

## Status

- [ ] Image uploaded to repo Social Preview setting (UI-only;
      tracked as a manual action).

The image file itself is intentionally **not** in this repo. Render
locally with the recipe above, upload via Settings → Social preview.
