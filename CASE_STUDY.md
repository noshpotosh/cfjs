## The short version

CFJS is a tiny library that lets you build websites out of reusable pieces of plain HTML. You don't need a big framework or a build step. You drop in one script and keep writing HTML the way you already do. It's still very early, and I have more ideas for where it could go than I have time to chase. But the core of what I wanted is here and working, and this portfolio site is built on it.

## Why I built it

I love vanilla HTML, CSS, and JavaScript. The thing I've always wanted is to write HTML in a more *composable* way: define a header once, reuse a card layout, render a list from some data. Normally that means pulling in a framework like React and a whole toolchain to compile it. For a lot of sites, that's a lot of machinery for not much gain.

So the goal was simple: make composing a page feel as easy as writing HTML, and stay out of the way as much as possible. You write a few custom tags like `<cf-include>`, `<cf-loop>`, and `<cf-if>`. The browser does the rest. There's no compiling, no bundling, and no special component syntax to learn.

This is a passion project first. I'm not sure how useful it'll be to anyone else, but I'll be using the heck out of it.

## What I liked most

**Everything stays contained.** Each view or component lives in its own HTML file, with its markup, styles, and behavior together. This turned out to matter a lot when working with AI tools. Usually an AI makes one change that touches twelve files, and you have to trace the whole flow to understand what happened. Here, if something changed, it's almost always in that one component's file. Reviewing changes got a lot easier, and honestly I enjoyed *using* CFJS as much as I enjoyed building it.

**It took much less code than I expected.** The whole runtime is one readable JavaScript file of a few hundred lines, with zero dependencies. I was surprised by how little library code it took to cover the base of what I'd been imagining for years.

**Building it alongside a real site kept it honest.** I developed CFJS together with this portfolio, so every feature had a real use case right away. That got me up and running fast and kept me from building things nobody (meaning me) needed. The documentation site is also built with CFJS, so it's another real-world test.

## Credit where it's due: ColdFusion

A lot of the inspiration (and the "CF" in the name) comes from ColdFusion, an older server-side web language. ColdFusion code can be a real pain to deal with. But its tag-based templating got the markup side *so* right. It had ideas that were ahead of their time, and I don't think other frameworks have fully caught up. It's genuinely my favorite templating language of all time, yes, even over JSX.

## What's next

- **Optional static site generation and builds.** Keep the no-build experience as the default, but let people pre-render pages when they want the speed or SEO benefits.
- **Performance testing and optimization.** I haven't really looked at performance yet, so I want to measure it properly before guessing.
- **A light redesign of the API.** In particular, I want to clean up the syntax for templating values that come from a `<cf-data>` tag.
- **Many more tags.** I picture a small core that adds as little to HTML as possible, plus optional add-on tag sets you can bring in to do some absolutely wild stuff.
