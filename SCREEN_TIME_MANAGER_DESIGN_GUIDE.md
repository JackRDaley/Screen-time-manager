# Screen Time Manager General Design Guide

## 1. Brand Identity

Screen Time Manager is a clean, focused productivity tool that helps users control distracting websites, understand their browsing habits, and build better digital discipline.

The product should feel:

- Calm
- Minimal
- Trustworthy
- Focused
- Lightweight
- Practical
- Slightly strict, but not aggressive

The brand should not feel:

- Overly corporate
- Flashy
- Gimmicky
- Wellness-heavy
- Motivational in a cheesy way
- Like a generic AI SaaS product
- Like a dark-mode crypto/startup app

The core idea is simple:

> Screen Time Manager helps users create friction between themselves and distracting websites.

## 2. Product Personality

The product should communicate like a practical focus tool.

It should feel like:

- A helpful guardrail
- A clean browser utility
- A quiet accountability system
- A productivity dashboard
- A tool that respects the user's time

It should not feel like:

- A life coach
- A meditation app
- A parental control app
- A punishment system
- A complicated analytics product

The tone should be clear, direct, and calm.

Good examples:

- "Block distracting websites before they pull you back in."
- "Set limits once. Let Screen Time Manager enforce them."
- "See where your attention is going."
- "Stay focused with simple website limits."

Avoid:

- "Unlock your ultimate productivity potential."
- "Revolutionize your digital wellness."
- "Crush your goals with next-gen focus technology."
- "Transform your life with powerful screen time optimization."

## 3. Visual Direction

The visual style should be inspired by:

- Chrome extension interfaces
- Google-style product design
- Lightweight productivity dashboards
- Clean browser tools
- Simple analytics cards

The product should look like something that belongs inside a browser.

Design priorities:

1. Clarity
2. Trust
3. Speed
4. Simplicity
5. Consistency

Avoid unnecessary decoration. The interface should feel polished, but not flashy.

## 4. Color Palette

### Primary Color

Use a Google-style blue as the main brand color.

Recommended:

- Primary blue: `#2563EB`
- Alternative blue: `#1A73E8`

Use blue for:

- Primary buttons
- Active states
- Important highlights
- Links
- Selected items
- Key dashboard accents

### Background Colors

Recommended:

- Main background: `#F8FAFC`
- Secondary background: `#F1F5F9`
- Card background: `#FFFFFF`
- Soft blue background: `#EFF6FF`

The product should mostly use white, gray, and blue.

### Text Colors

Recommended:

- Primary text: `#0F172A`
- Secondary text: `#475569`
- Muted text: `#64748B`
- Very light text: `#94A3B8`

### Border Colors

Recommended:

- Light border: `#E2E8F0`
- Medium border: `#CBD5E1`

### Status Colors

Recommended:

- Success: `#16A34A`
- Warning: `#F59E0B`
- Danger/blocked: `#DC2626`
- Info: `#2563EB`

Use status colors sparingly. Blue should remain the dominant accent color.

## 5. Typography

Use a clean, modern sans-serif typeface.

Recommended fonts:

- Inter
- Geist
- System UI
- SF Pro-style stack

Typography should feel:

- Clean
- Modern
- Neutral
- Highly readable

Avoid:

- Playful fonts
- Futuristic fonts
- Overly rounded fonts
- Decorative fonts

### Suggested Type Scale

Hero heading:

- Desktop: 48-64px
- Mobile: 36-44px

Page heading:

- 32-44px

Section heading:

- 28-36px

Card heading:

- 18-22px

Body text:

- 16-18px

Small labels:

- 13-14px

Microcopy:

- 12-13px

Headings should be bold, but not oversized without purpose.

## 6. Shape Language

The interface should use soft, modern rounding.

Recommended border radius:

- Small controls: 8-10px
- Buttons: 10-14px
- Cards: 16-24px
- Pills/badges: 999px

Cards should feel friendly and modern, but still clean and structured.

Avoid:

- Sharp enterprise-style boxes
- Excessively bubbly shapes
- Heavy 3D styling
- Neumorphism

## 7. Shadows and Borders

Prefer subtle borders over heavy shadows.

Recommended card style:

- White background
- 1px solid light gray border
- 16-20px border radius
- Soft shadow only when needed

Example shadow:

```css
box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
```

Avoid:

- Heavy drop shadows
- Glow-heavy elements
- Neon effects
- Dramatic depth

The design should feel crisp and lightweight.

## 8. Layout Principles

The product should use spacious, organized layouts.

General principles:

- Use clear hierarchy
- Group related controls together
- Use cards for major sections
- Keep important actions obvious
- Reduce visual clutter
- Keep dashboards scannable
- Make empty states helpful

Every screen should answer:

1. What is happening?
2. What can the user do next?
3. What is most important?

## 9. Component Style

### Cards

Cards should be used for:

- Dashboard stats
- Feature sections
- Settings groups
- Domain lists
- Activity summaries
- Usage insights

Card styling:

- White background
- Light border
- Rounded corners
- Comfortable padding
- Clear heading
- Optional muted description

### Buttons

Primary buttons:

- Blue background
- White text
- Medium rounded corners
- Clear action label

Secondary buttons:

- White or light gray background
- Dark or blue text
- Light border

Destructive buttons:

- Red accent
- Use only when needed

Button labels should be specific.

Good:

- "Add domain"
- "Start focus block"
- "Save limit"
- "Remove site"

Avoid:

- "Submit"
- "Click here"
- "Proceed"

### Badges and Pills

Use badges for:

- Active
- Blocked
- Limit reached
- Focus mode
- Today
- New

Badge styling:

- Rounded pill shape
- Soft background
- Small text
- Muted but readable color

### Inputs

Inputs should be simple and browser-native feeling.

Input styling:

- White background
- Light border
- Rounded corners
- Clear placeholder text
- Visible focus ring using primary blue

Good placeholders:

- `youtube.com`
- `Add a distracting website`
- `Search domains`

## 10. Icons

Use simple line icons.

Recommended:

- Lucide icons
- Heroicons
- Similar clean outline icon sets

Icon style:

- Rounded
- Minimal
- Blue/gray
- Consistent stroke width

Good icon themes:

- Clock
- Shield
- Lock
- Browser window
- Bar chart
- Check mark
- Timer
- Eye
- Alert circle

Avoid:

- Filled cartoon icons
- Complex illustrations
- Emoji-heavy UI
- Inconsistent icon sets

## 11. Data Visualization

The product may show user activity, blocked pages, domain usage, or screen time trends.

Charts should be:

- Simple
- Readable
- Lightly styled
- Focused on useful insight

Use:

- Bar charts
- Small trend lines
- Simple counters
- Daily summaries
- Domain ranking lists

Avoid:

- Complex analytics dashboards
- Too many colors
- Overly technical metrics
- Decorative charts with no clear purpose

Data should help the user understand behavior quickly.

Good examples:

- "25 blocked page views today"
- "You added 4 distracting sites this week"
- "You hit your YouTube limit 3 times today"
- "Most blocked site: youtube.com"

## 12. Copywriting Principles

Copy should be:

- Clear
- Short
- Practical
- Calm
- Direct

The product should not shame the user.

Good:

- "You've reached your daily limit."
- "This site is blocked during your focus block."
- "Take a quick reset before returning."
- "Add sites that usually pull you off task."

Avoid:

- "You failed."
- "You wasted too much time."
- "You have no discipline."
- "Stop being distracted."

The product should create accountability without sounding judgmental.

## 13. Blocked Page Experience

The blocked page is one of the most important brand moments.

It should feel:

- Calm
- Firm
- Minimal
- Helpful

It should clearly show:

- The site that was blocked
- Why it was blocked
- When it becomes available again, if applicable
- A simple next action

Good blocked page copy:

- "This site is blocked right now."
- "You set a limit for youtube.com."
- "Come back tomorrow, or adjust your settings from the extension."
- "Focus block active."

Avoid making the blocked page too playful or too harsh.

## 14. Privacy and Trust

Because the product tracks domains, time, and blocking activity, trust is essential.

Privacy messaging should be clear and visible.

Core privacy message:

> Screen Time Manager only tracks the activity needed to provide website blocking, limits, and usage stats.

The brand should communicate:

- No unnecessary tracking
- No selling user data
- No creepy monitoring
- User control over tracked domains/settings
- Simple, transparent behavior

Privacy copy should be plain English, not legal-sounding unless it is in the actual privacy policy.

## 15. Motion and Animation

Use motion sparingly.

Acceptable:

- Subtle fade-ins
- Small hover transitions
- Smooth expand/collapse
- Gentle loading states

Avoid:

- Parallax-heavy pages
- Constant motion
- Bouncy animations
- Distracting effects
- Flashy startup-style transitions

Since the product is about focus, the design should not be visually distracting.

## 16. Accessibility

The product should be readable and usable.

Requirements:

- Strong color contrast
- Clear focus states
- Keyboard-friendly controls
- Large enough tap/click targets
- Labels for inputs
- Avoid color-only meaning
- Respect reduced motion preferences

The design should feel lightweight, but not at the expense of usability.

## 17. Responsive Design

The product should work well across:

- Chrome extension popup sizes
- Desktop dashboard views
- Mobile website screens
- Tablet-sized layouts

Responsive principles:

- Stack cards on small screens
- Keep buttons large enough
- Avoid cramped analytics
- Prioritize the main action
- Hide nonessential details when space is limited

## 18. Product Consistency Rules

Every Screen Time Manager surface should share the same design language.

This includes:

- Extension popup
- Dashboard
- Blocked page
- Website
- Privacy page
- Feedback page
- Changelog
- Future onboarding
- Future paid/pro pages

Consistency rules:

- Use the same blue
- Use the same card style
- Use the same typography
- Use the same icon style
- Use the same tone of voice
- Use the same spacing logic
- Use the same border and shadow style

The website should not feel like a separate brand from the extension.

## 19. Things to Avoid

Avoid:

- Generic SaaS landing page styling
- Purple/blue AI gradients
- Dark crypto-style design
- Overly motivational language
- Stock photos
- Abstract 3D blobs
- Excessive animations
- Complicated dashboards
- Enterprise-heavy language
- Shame-based copy
- Childish anti-distraction visuals
- Too many colors
- Over-designed sections

## 20. Design Goal

A user should feel within seconds that Screen Time Manager is:

1. Simple
2. Useful
3. Trustworthy
4. Focused
5. Easy to understand
6. Built for real browser-based productivity

The design should make the product feel like a polished Chrome extension that helps users control distractions without adding more noise.
