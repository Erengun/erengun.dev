---
slug: "compiled-2"
title: "Compiled #2: Microsoft Went Down, Huang Is Out, and My Site Still Stutters"
summary: "A world without email for 24 hours, Jensen Huang's resignation and the push for Tim Cook to replace him, the three.js pain behind my new 3D site, and why you can't fix every problem with Rust."
date: "2026-11-16"
tags: ["Microsoft", "Nvidia", "threejs", "WebGPU", "Rust", "Compiled"]
lang: "en"
translation: "derleme-2"
---

![Claude Monet, Impression, Sunrise (1872): the sun rising over a misty harbour](/blog/derleme-2/monet-impression-sunrise.webp)

*Claude Monet, Impression, Sunrise, 1872. The painting that gave a movement its name: the work changed first, the name came later.*

Hello, lovely people. Did your email arrive this week? If it didn't, it wasn't you. It was Microsoft.

A quick announcement first: this series is now called **Compiled** (in Turkish, *Derleme*, a word that means both "compile" and "collection"). That's exactly what it does: it collects the week's messy code, compiles it and puts it in front of you. Sometimes the compiler throws an error; we'll see that too.

A confession: I didn't get the first issue out on Substack in time. If you're curious about it (the AI bubble, Monte Cristo and the Huang spy allegation), you can [read it on my website](https://erengun.dev/blog/compiled-1/).

This week: Microsoft stopping the world for a day, Jensen Huang, who I said last week was "staying in his seat" and no longer is, the three.js pain behind my new site, and why Rust isn't the answer to everything.

## No email, no work

You know what happened on the evening of Thursday, November 12? Outlook went down. Teams went down. Copilot went down. Every piece of Microsoft 365, worldwide, gone. For about 24 hours, friends. Then Microsoft came out and said, "We are deeply sorry." The cause? A network upgrade that went wrong. A cyberattack? No, they say, no sign of one.

Ali abi (Ali Kutluözen; *abi* is how we say "big brother" in Turkish) put it perfectly [in his video](https://www.youtube.com/watch?v=kX4cor_RBSQ) (in Turkish): **when email stopped, we found out our jobs were mostly email.** You can't send mail. You can't join the meeting. You just sit there, staring at the screen.

Now think about it. Tens of thousands of engineers. Interviews that make you grind LeetCode for weeks. Million-dollar government contracts. And Teams? Teams has been lagging for ten years. Lagging, my friend. Lagging.

One of Ali abi's points made me laugh, because it hurts and it's true. We're embarrassed to put even a side project on GitHub. "Someone will see it, someone will say 'bro, there's a security hole here.'" We hesitate to deploy, we say one more fix, and the thing never ships. **Meanwhile giant Microsoft takes millions of dollars and ships a buggy Teams with a clear conscience.**

By the way, the problem isn't the engineers. There are seriously good developers there. The problem is size. Brooks's famous law said it 50 years ago: add people to a late project and it gets later. Why? Because every new person multiplies the number of people who have to talk to each other. On a ten-person team everyone knows everyone. At a four-thousand-person company, you don't even know who the CEO is.

So, HR friends, I'm talking to you: **stop selling the "we're one big family" lie.** Past eight people we're not a family, we're an organization. We're not related, either.

## Huang is out. Tim Cook in?

What did I say last week? "Bubbles don't pop with a big needle, but through a small hole." Did it take a week? It did not.

Nvidia filed with the SEC: Jensen Huang has **resigned** as CEO and from the board, effective immediately. The reason? Not stated. A word from Huang? Not one. Colette Kress, CFO since 2013, is interim CEO, and Harvey C. Jones became the company's first board chair.

Then the real show started, friends. Trump went on Truth Social: there is "only one man" to take Huang's place, and that's Apple's Tim Cook. "A Legend replaces a Legend!" Let me remind you, Cook isn't even Apple's CEO anymore: he handed the job to John Ternus on September 1 and is now executive chairman. Did he answer? No report that he did. Over on [r/pcmasterrace](https://www.reddit.com/r/pcmasterrace/comments/1xu9zqp/theres_a_possibility_former_apple_ceo_tim_cook/), the story is already making the rounds.

In Monte Cristo, Dantès's revenge took years. In Silicon Valley the same movie plays in a week. **What is a company worth when its whole valuation leans on one man, and that man walks out?** I don't know. The November 17 earnings will tell us, and the months after.

---

## My new site and the three.js pain

I wasn't sitting still this week either; I had my own small disasters. I rebuilt [erengun.dev](https://erengun.dev) from scratch. It's not a website anymore, friends, it's a 3D journey you scroll through. An intro built from my ski photo, a city that twists around itself, a separate world for each of my projects, and at the end a lantern alley made of 500,000 dots. On top, a VHS camcorder and a CRT effect. A separate Claude agent built each world, all in parallel.

On day one the site worked. The next four days? All performance. Some memories:

- **My head looked like a weirdo.** Four versions of my 3D portrait went in the trash. My actual message at the time: "intro my 3d head is really realy looking like weirdo now". In the end we went back to the ski photo. Not technical, but it took the longest.
- **The page downloaded 33 MB before it even opened.** One sitting, 7 MB. Turns out the last scene was drawing everything twice. Twice!
- **Freezes while scrolling on iPhone.** The site was preparing everything the very moment it first hit the screen, and froze for a blink every single time. We prepared it all up front: 13 freezes became 1.
- **The intro ran at 7 frames a second on Android.** The ski photo was made of about 181,000 tiny dots, and the poor phone was drawing every one of them. We turned the background into a flat image and kept the dots just for me. 7 frames became 30.
- **Firefox drew long streaks across the screen.** The cause? One line of math. Fine in every other browser, nonsense in Firefox.
- **Firefox was really slow.** Was it? It wasn't. Our own debug overlay, the thing measuring the speed, was slowing Firefox down. Turn it off and it flew. We were measuring our own measuring tool.

## You can't fix everything with Rust

Last week I praised Rust to the skies, and I still stand by it. But on this site I fell into the same trap. I literally wrote to Claude: "Please find a solution without making quality trash, I think we need to low level like rust or go idk."

The answer? No. **Compile Rust or Go to WebAssembly and you still call the same WebGL/WebGPU functions, wait on the same shader compiler, and freeze in the same place.** Our JavaScript already took about 1 ms per frame. Sorting 60,000 dots took 1 ms, in a separate worker. The language wasn't slow.

Look at the list above again. None of it is a "slow language" problem:

- The freezes: GPU pipelines compiling at the wrong time.
- Brave: the amount of data. However fast the language, you still have to draw 181,000 splats.
- The Firefox streaks: shader math. `pow` with a negative base is undefined in Rust too.
- The startup stutter: uploading textures on the main thread. Moving them to bitmaps decoded on a separate thread cut main-thread upload time from 700 ms to 78 ms.

What does Rust fix? Correctness. Memory bugs, data races, the nonsense agents produce. What fixes performance? **Not the language, but knowing where the machine waits.** When the GPU compiles, when the main thread blocks, how big the data is, which math goes crazy in which browser. Measure first, friends, then rewrite. Most of the time you won't even need to.

## Software development is changing. So what's the new name?

Think about it: when did you last write a function from start to finish yourself? I don't remember. Most of the job now is telling an agent what to do, reading what it wrote, and catching what it got wrong. We're not writing code anymore, friends, we're getting code written. The job changed. The title is still "Software Developer."

I chewed on this all week, because I was rewriting my LinkedIn profile and got stuck on the very first line, the headline. Here's the thing: I don't have an engineering degree. I come from École 42 Istanbul; no teachers, no lectures, plenty of segfaults. In Turkey, "engineer" (*mühendis*) is a legally protected title. Abroad, "Software Engineer" is often just a job title. So what do I call myself?

I sat down and researched it. Look around: AI Engineer. Agentic Engineer. Product Engineer. Founding Engineer. Forward Deployed Engineer. They all smell of AI. Companies are moving from the "developer who does everything" to narrower titles defined by the work.

I almost fell for Forward Deployed Engineer myself. Palantir's definition sounds great: **a developer takes one capability to many customers; an FDE takes everything to one customer.** I read it and went, "wait, that's me." Then I asked around. Some call it consulting with a fancy name. Others say it's installing your company's software on the customer's computer, and that's it. So sometimes an FDE is just the old guy going door to door with an install CD, now with a LinkedIn title. A shiny title doesn't mean there's anything inside.

### What does Applied AI mean?

Then I ran into this phrase: **Applied AI.** Lots of people at Anthropic have it on their profiles. What does it mean? Not training models; that's the researchers' job. Applied AI is taking the models that exist and applying them to a real product, a real customer's problem. Setting up the agent, wiring it in, catching its mistakes, making it actually work. In other words, exactly the job most of us now do every day.

I got curious and looked at those people's profiles one by one. Kevin Bai, for example, at Anthropic; he also gave a talk called "Forward Deployed Engineering 101." His profile opens with "Hello, my name is…", short paragraphs, and one detail you won't forget: he speaks all six official UN languages. Trevor Spires's is even shorter: "I'm Trevor 👋 Lately I'm into…" A bit of what he does, a bit of his hobbies, zero bragging. Another one tells his career chronologically, with years, things he built and real numbers.

What do they have in common? All first person, like they're talking to you. Facts, not adjectives. No "passionate" or "innovative," no keyword stuffing. Not even awards in the About. And their skills list: five broad, established disciplines instead of trendy words.

So that's what I did. My headline now says **Software Developer | Applied AI.** It's a field, not a title. It says what I do without pretending I'm something I'm not. I rewrote my About too: no adjectives, just real projects and real numbers.

### Being lost is a form of ambition

While researching, I looked at the dark side too, of course. According to Stanford's 2025 study *Canaries in the Coal Mine?*, in the jobs most exposed to AI, software included, employment of young workers is falling while experienced workers hold steady. Why? Because the agent writes the code, but knowing what's wrong with it takes years. There are more optimistic readings too: historically, as productivity went up, software jobs didn't shrink, they grew. And Anthropic's own research says letting AI write everything is the fastest way, but it kills learning.

In short: **entry level is shrinking; seniority and judgment are growing.** Use AI, I'm not telling you not to. But understand the code it writes. That is the new job.

While reading all this, one video kept spinning in my head: Jett Franzen's [You're not lost, you're just 22](https://www.youtube.com/watch?v=JNAU5iZ7Tnc). I'm not 22. But this week, rebuilding both my site and my profile from scratch, I felt pretty lost.

The line that stuck comes from his sales days: **it doesn't take time to make decisions, it takes information.** And where do you get information? Not by sitting and thinking. By trying and failing. What did I say about padel last week? While you wait for the right time, you just keep building it in your head. Same thing.

Franzen says one more thing: someone who stays put and tries nothing isn't lost, they're stagnant. Getting lost is a side effect of moving forward. You go to a new city, close the map, and learn your way home from the signs. That's exactly how this site went: four days lost, then we found our way home.

So what will software development be called? I don't know. Maybe "AI Engineer" sticks; maybe in five years we'll just call everyone a developer again. Remember "Webmaster"? Nobody uses that title now, but the work still gets done. **The job changes first; the name comes later.** And right now we're right in between: in a city with no map, reading the signs.

---

Microsoft, Nvidia and my 3D site all taught the same thing this week: **you can't fix a system without looking inside it.** Size won't do it. Hype won't do it. A new language won't do it either.

Your turn, lovely people. What did you want to rewrite this week but didn't? Or did you catch yourself saying "it'll be fine if we rewrite it in Rust"? Write to me, I read them all.

If you found this useful, send it to that HR friend who writes "we're one big family" in job posts. See you next week.

---

*Sources:* [Nvidia 8-K (SEC)](https://www.sec.gov/Archives/edgar/data/0001045810/000104581026000082/nvidiaannouncesceotransiti.htm) · [TechCrunch: Trump floats Tim Cook](https://techcrunch.com/2026/11/12/trump-floats-apple-chairman-tim-cook-as-jensen-huangs-successor/) · [Windows Central: Microsoft apologizes](https://www.windowscentral.com/microsoft/we-are-deeply-sorry-microsoft-apologizes-for-major-outage-that-knocked-outlook-teams-and-microsoft-365-offline-for-24-hours-insists-it-wasnt-ai-that-caused-it) · [BleepingComputer: Microsoft 365 outage](https://www.bleepingcomputer.com/news/microsoft/massive-microsoft-365-outage-disrupts-outlook-teams-copilot-worldwide/)
