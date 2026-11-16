---
slug: "compiled-2"
title: "The new name for software development, and is Rust really our magic wand? Plus Microsoft and Nvidia | Compiled #2"
summary: "Hey everyone. When did you last write a function from start to finish yourself? I don't remember. We don't write code anymore, we get it written. So what's this job called now?"
date: "2026-11-16"
tags: ["Compiled", "Software Development", "AI", "Rust", "three.js", "Tech News"]
lang: "en"
translation: "derleme-2"
---

<figure>
  <img src="/blog/derleme-2/monet-impression-sunrise.webp" alt="Claude Monet, Impression, Sunrise (1872)" width="1600" height="1126" />
  <figcaption>Claude Monet, Impression, Sunrise (1872)</figcaption>
</figure>

This week we're talking about Microsoft breaking the world for a day, the Jensen Huang saga (hopefully for the last time), the three.js struggle behind my new website, and why Rust isn't the answer to everything.

First, a small announcement: Open Tabs has a new name, Compiled (*Derleme* in Turkish). It comes from "compile," and in Turkish it also means "a collection." That's exactly what I want this newsletter to be: gathering the topics I scattered all over during the week and putting them in front of you.

This actually isn't the first issue, but unfortunately I didn't get the first one onto Substack in time. If you're curious about it (the AI bubble, Monte Cristo and the Huang spy allegation), you can [read it on my website](https://erengun.dev/blog/compiled-1/).

## No email, no work

Thursday evening, Outlook went down. Teams went down. Copilot went down. Every piece of Microsoft 365 went down. The cause? A network update that went wrong. A cyberattack? Unclear.

Ali abi (Ali Kutluözen; *abi* is how we say "big brother" in Turkish) put it perfectly [in his video](https://www.youtube.com/watch?v=kX4cor_RBSQ) (in Turkish): when email stopped, we found out our jobs were mostly email. You can't send mail. You can't join meetings. You can't do anything.

AI has already cut our development costs a lot. I think companies should start building their own independent setups. Instead of Teams, which has lagged ever since Microsoft launched it and won't let you in whenever it feels like it, let's take an open-source project and build our own Teams on top of it. Or at the very least, let's not depend on a single company: use an alternative like Slack.

## Huang is out. Tim Cook in?

Last week we said, "Bubbles don't pop with a big needle, but through a small hole." It didn't take a week.

Jensen Huang **resigned** as CEO and from the board. Colette Kress, CFO since 2013, stepped in as interim CEO, and Harvey C. Jones became the company's first board chair.

There's "only one man" to take Huang's place: Apple's Tim Cook. Over on [r/pcmasterrace](https://www.reddit.com/r/pcmasterrace/comments/1xu9zqp/theres_a_possibility_former_apple_ceo_tim_cook/), it's already the talk of the day.

**What is a company worth when it leans its whole valuation on one man, and that man leaves?** I don't know.

## My new website and the three.js struggle

Websites feel ordinary and boring to me now. So instead, I rebuilt [erengun.dev](https://erengun.dev) as a 3D journey you pass through as you scroll. An intro built from my ski photo, a city that twists around itself, and every project scene designed as its own world. Claude and I got it done in a day, and then I spent the whole weekend on performance because it was lagging on my friends' phones. At one point, out of desperation, I even thought about going low level with Rust or something.

In short:

- The page downloaded 33 MB before it even opened. We got it down to 7 MB. Turns out things were being drawn twice.
- Freezes while scrolling on iPhone. The site was preparing everything in real time as it came on screen, which caused the freezes. We prepared it all up front at startup.
- The intro ran at 7 fps on Android. The opening scene is made of roughly 181,000-odd dots, and the phone was trying to draw every single one.
- Firefox problems. The cause was just math. It worked fine in other browsers, but in Firefox it looked really bad.

## You can't fix everything with Rust

Last week we praised Rust. While fighting with my website, I wrote this to Claude, word for word, as if Rust were a magic wand: "Please find a solution without making quality trash, I think we need to low level like rust or go idk."

Try it in Rust, try it even in C, the result will be the same. You're using the same functions, waiting on the same shader compiler, and you freeze in the same place. The language isn't slow.

Look at the list above again. None of it is a Rust problem:

- The freezes come from GPU compilation.
- However low level or fast the language is, you still have to draw 181,000 dots.
- The Firefox problems are pure math.
- The stutters came from trying to do all the work at once. Splitting it into pieces fixed them.

So what does Rust fix? Correctness. Memory bugs and leaks, the nonsense AI produces. What fixes performance? Not the programming language, but knowing where the machine gets stuck. So analyze the problem properly first, then rewrite. Most of the time you won't even need to rewrite.

## Software development is changing. So what's the new name?

When did you last write a function from start to finish yourself? I don't remember. Most of the job now is telling an agent what to do, reading what it wrote, and catching what it got wrong. We don't write code like we used to; we're doing something more like operating or managing. The job changed. But the title is still "Software Developer."

Like every white-collar worker, I was editing my LinkedIn profile for the hundredth time when I got stuck on this question. "Software engineer" amounts to the same thing, and besides, the everyone-is-an-engineer wave has already started.

I looked into it. Out there you'll find roles like AI Engineer, Agentic Engineer, Product Engineer, Founding Engineer, Forward Deployed Engineer. If you noticed, they're all about AI. Companies are moving away from language-based roles toward more pragmatic, more action-oriented ones.

At first, Forward Deployed Engineer sounded cool. The definition, in short: a technical expert who works at customer sites or in direct contact with customers, putting the company's products to work in the field. Then I asked around. Some call it "consulting with a pink name." Others say it's "the guy who installs the company's software on the customer's computer, and that's it." Turns out looking cool on LinkedIn doesn't mean there's anything inside.

### What does Applied AI mean?

Then I tried a different approach and looked at the people who work on Claude. The titles you'll see most are FDE and Applied AI. Lots of profiles say Applied AI @ Anthropic. Applied AI means using today's AI models to solve product and customer problems and make them ready for real use. It's very close to the work we do these days.

### Being lost is a form of ambition

This week, rebuilding both my website and my profile from scratch, I felt pretty lost.

It doesn't take time to make decisions, it takes information. Where do you get information? Not by sitting and thinking, but by trying and failing. What did I say about padel last week? While you wait for the right time, you just keep building it in your head. Same thing. It's a skill we didn't pick up from the older generations; I think we've become a very play-it-safe generation.

According to [Franzen](https://www.youtube.com/watch?v=JNAU5iZ7Tnc), someone who stays put and tries nothing isn't lost, they're stagnant. Getting lost is a side effect of moving forward. You go to a new city, close the map, and learn your way home by reading the signs.

So what will software development be called? I don't know. Maybe "AI Engineer" sticks, maybe in five years we'll just call everyone a "developer" again. The work changes first, the name comes later. And right now we're right in between: in a city with no map, reading the signs.

Your turn, lovely people. What does your LinkedIn say right now? Software Engineer, Developer, or did you also just add an "AI" and move on?
