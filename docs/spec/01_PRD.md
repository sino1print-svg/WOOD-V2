# 01_PRD.md

# Mockup Photoshoot Director

## Product Requirements Document (PRD)

**Version:** 1.0

------------------------------------------------------------------------

# 1. Vision

The application is **NOT** a prompt generator.

The application is a complete **Mockup Photoshoot Director** for Etsy
and Print-on-Demand sellers.

It builds a complete commercial mockup photoshoot session from the
user's selections.

------------------------------------------------------------------------

# 2. Core Philosophy

The software must behave like a professional commercial photographer.

Always optimize for:

-   Print area visibility
-   Etsy conversion rate
-   Commercial realism
-   Consistency
-   Expandability

Never optimize for randomness.

------------------------------------------------------------------------

# 3. Main Workflow

``` text
Project
↓
Photoshoot Session
↓
Products
↓
Scenes
↓
Prompt Generation
↓
Main Cover
↓
Export
```

------------------------------------------------------------------------

# 4. Outputs

Every scene always produces two outputs.

## Output A

Blank Sale Image

-   Blank garment
-   No artwork
-   No logo
-   No watermark
-   No typography

## Output B

Matching Preview Image

Must use:

-   Output A as source image
-   Uploaded PNG artwork

Only the artwork changes.

Everything else remains identical.

------------------------------------------------------------------------

# 5. Main Cover

The cover is generated after all Sale Images exist.

Rules:

-   Uses Sale Images (A) only.
-   Never uses Preview images.
-   Automatically reads:
    -   Product
    -   Colors
    -   Mockup count
    -   Views
    -   Season
    -   Digital product status
-   Layout changes automatically based on mockup count.

------------------------------------------------------------------------

# 6. Products

Supported products:

-   Bella Canvas 3001
-   Classic T-Shirt
-   Comfort Colors
-   Oversized
-   Hoodie
-   Crewneck
-   Kids
-   Tank
-   Polo
-   Raglan
-   Zip Hoodie

The system must support future products without code restructuring.

------------------------------------------------------------------------

# 7. Seasons

Each season owns an independent Scene Library.

Examples:

-   Halloween
-   Christmas
-   Valentine's Day
-   Mother's Day
-   Father's Day
-   Back to School
-   Summer
-   Fall
-   Winter
-   Teacher
-   Minimal Studio

------------------------------------------------------------------------

# 8. Rule Engine

Examples:

If season = Father's Day

-   No Mother's Day decorations.
-   No Mother/Child hero scenes.

If product = Kids

-   Adult fashion models are forbidden.

If selected colors = White + Black

-   No other colors may appear.

If requested scene count = 3

-   Generate exactly 3 scenes.

Never duplicate:

-   Scene
-   Pose
-   Camera angle
-   Composition

------------------------------------------------------------------------

# 9. Scene Engine

A scene is assembled dynamically from:

-   Product
-   Location
-   Lighting
-   Decor
-   Props
-   Camera
-   Composition
-   Pose
-   Display Method
-   Palette
-   Season
-   Print Area Rules

------------------------------------------------------------------------

# 10. Prompt Engine

Modules:

-   Global Rules
-   Product Rules
-   Season Rules
-   Scene Rules
-   Output A
-   Output B
-   Cover Prompt
-   Group Prompt

------------------------------------------------------------------------

# 11. Print Area Rules

Highest priority.

Printable area must always be:

-   Large
-   Centered
-   Clean
-   Visible

Forbidden:

-   Hands
-   Hair
-   Props
-   Deep folds
-   Shadows covering print area

------------------------------------------------------------------------

# 12. Export

Support:

-   Copy Output
-   Copy Group
-   Copy Cover
-   Copy Session
-   Copy All
-   TXT
-   JSON
-   ZIP

------------------------------------------------------------------------

# 13. Save System

-   Save Project
-   Load Project
-   Duplicate Project
-   Recent Projects
-   Reset
-   Version History

------------------------------------------------------------------------

# 14. Validation

Before generation validate:

-   Season
-   Audience
-   Products
-   Colors
-   Scene Count
-   Duplicate Scenes
-   Print Rules
-   Cover Data

Generation must stop if validation fails.

------------------------------------------------------------------------

# 15. Success Criteria

The application behaves as a professional mockup photoshoot director.

The prompts require minimal editing.

Every generated mockup is suitable for commercial Etsy listings.

The architecture must remain modular and expandable.
