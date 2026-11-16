---
slug: "compiled-1"
title: "Compiled #1: The AI Bubble, Nvidia's Monte Cristo Week and Padel in November"
summary: "The $100 billion loop between Nvidia, OpenAI and Microsoft, the spy allegation shaking Jensen Huang, why everything is being rewritten in Rust, and the tabs I kept open this week."
date: "2026-11-09"
tags: ["AI", "Nvidia", "Rust", "DeveloperTools", "Compiled"]
lang: "en"
translation: "derleme-1"
---

Hello, lovely people. Has the bubble popped? No. Will it? Probably. And honestly: let it pop.

Welcome to the first issue of Compiled. Every week I dump here whatever I couldn't bring myself to close in my browser. This week there are four tabs open: the AI bubble, the spy allegation shaking Nvidia's CEO, why everything is turning into Rust, and a few tools that tame the agent chaos on my desk.

## The money moves, the value doesn't

Here's the loop in short. **Nvidia pledges up to $100 billion to OpenAI.** OpenAI uses that money to rent cloud capacity from Microsoft so it can train its models. Microsoft, to grow its data centers, goes and buys chips from Nvidia. The money goes around and lands right back where it started.

What makes the news? "A hundred-billion-dollar mega investment." Demand for Nvidia chips is through the roof, Microsoft breaks cloud records. On paper, everything shines.

But who pays the bill at the end of the loop? Us. What comes out of my pocket is $20 a month, $200 if you go all in. Maybe a few million if you run a company. That's it.

The investor puts in 100 and expects 150 next year. Waits, and it doesn't come. Because **your $20 and mine don't turn that mill.** GPT-4 came out, then 5, and investors still haven't seen their return. The belief slowly cracks.

And when it cracks? Investors put less into the next round. OpenAI can't pay its debts, because investors aren't paying in. Microsoft can't collect, because OpenAI can't pay. Nvidia's sales drop, because Microsoft stops buying chips. That's how the dominoes fall.

I'm reading *The Count of Monte Cristo* these days. For years in Turkey it was summed up to us as "the book *Ezel* is based on" (a hit Turkish TV series), but it has nothing to do with it. It's a much colder, much darker reckoning.

The first thing that hits you reading it: **show people status or a bit of money and they're wired to sell out even the person closest to them, in a second.** Especially in our modern business world, where "everyone smiles at everyone," this rule never changes. The moment you turn your back, the deal is turned on you.

Ali Kutluözen drew this circular economy really well [in his video](https://www.youtube.com/watch?v=G-0Z890yLt0) (in Turkish). Worth a watch.

## The biggest gear in the machine is shaking

Speaking of Monte Cristo, this week the book came true on its own.

On Sunday, November 8, Nvidia CEO Jensen Huang sent an email to employees: "I was unfaithful to my wife. My actions hurt her and our children. There is no excuse for what I did." **That part is certain; he says it himself.**

The rest is an allegation, and what an allegation. According to US intelligence sources speaking to the New York Times and the Financial Times, the woman he had the relationship with, Alice Huang (Huang Le), works for Chinese intelligence. Same surname, no relation, by the way.

MegaSpeed, the Singapore-based company where she has served as an executive, has bought more than $4.8 billion in chips from Nvidia since June 2024, according to the NYT. US authorities are also investigating whether the company helped smuggle restricted AI chips into China.

China's foreign ministry dismissed the "so-called Chinese spy narrative." Nvidia's board opened an independent investigation and says it sees no sign that company secrets leaked; Huang stays in his seat. And the market? On Monday, November 9, Nvidia stock fell 5% while AMD, Arm and Intel rose. Three House committees have also called Huang to a closed-door briefing on November 18.

Now think about it: the man at the very center of the $100 billion loop. That whole valuation leans on "whatever Jensen says goes." That trust cracked with a single email. **That's how bubbles pop, friends: not with a big needle, but through a small hole nobody accounted for.**

Remember who sold out Dantès. The people closest to him. Money, status, and a salon where everyone smiles at each other.

## What happens to us when it pops?

Is it the apocalypse? No.

When the dot-com bubble burst in 2000, did the internet end? No, it came out stronger. **The showmen selling internet packages door to door on CDs went bust.** What stayed were the fiber cables, the protocols and the companies that actually created value. Amazon walked out of that wreckage and today has enough money to buy the world.

The same thing will happen now. The *AI wrapper* junk that raised $8 million saying "we're closing the gap in the construction industry with AI," while sending plain prompts to the OpenAI API behind the scenes, will get swept away. They weren't profitable anyway. And if they were, OpenAI raises its prices and they can't pass that on to their customers.

Capitalism works like evolution here, friends: start 10 companies, 9 go under, one barely survives. We shake the survivor's hand.

But the data centers, the open-weight models and the local models running on your own machine aren't going anywhere. Nobody can take weights you've already downloaded. Not to mention the Chinese and European models.

And here's the good part: when the bubble pops, those giant GPU farms will sit empty. Supply and demand is simple. **The GPU we pay $5 an hour for today, we'll rent for $2.**

Like Edmond Dantès shedding his naive self and seeing the real world, we need to see the truth behind this hype cloud. **You can't control Silicon Valley's financial games, but you can control your own architecture and your real engineering muscles.**

---

## Why is everything turning into Rust?

Speaking of real engineering, [this Reddit thread](https://www.reddit.com/r/rust/comments/1xqudci/everything_is_becoming_rust_now/) hits the nail on the head. From game engines to Discord, from Adobe alternatives to system tools, why is everything suddenly being rewritten in Rust?

For years we told managers, "We need strict type safety, we need good error messages." Nobody cared. **The moment coding agents entered the picture, compiler quality suddenly became the top priority.**

Because if you leave an LLM alone with C++, you burn millions of tokens debugging *undefined behavior* and *memory leaks*. The agent writes the code, the code looks like it works, and three days later it blows up in production.

Rust's compiler, the one that drives beginners crazy and slaps you in the face, catches the error before the code ever runs. `rustc` gives the agent clear feedback: "you're wrong here, for this reason." The agent fixes it and tries again. Short loop, few tokens.

A language designed so humans would write safer code is now the most efficient token-saving tool for agents to write code without blowing up the system. Just so you know.

---

## Overthinking and open tabs

Every day on my way to the gym I eye the padel courts across the street. Going in and out from under the weights, watching people play, I've really started wanting to try it. I'm starting this week.

Yes, it's November, and I've picked the worst possible season to start an outdoor racket sport. But **while you wait for "the right time," you just keep building it in your head.** Sometimes you have to stop overthinking and just walk onto the court.

I live the same mess at my screen. Three VS Code windows, docs on one side, agent output on the other. Full ADHD spiral. These are the tabs I kept open this week to pull it together:

- **[agent-deck](https://github.com/asheshgoplani/agent-deck) & [ThinkRail](https://github.com/JetBrains/thinkrail):** I've fallen hard for agent-deck. From a single tmux-based terminal UI you manage Claude, Gemini and Codex sessions; which one is running, which one is waiting for approval, all on one screen. JetBrains hasn't been idle either: ThinkRail, their open-source tool built around the `pi` agent, puts every task in its own `git worktree` and uses a `SPEC.md` so the agent doesn't lose context.
- **[api-anything](https://github.com/goodnight000/api-anything):** Goodreads and Google Flights have no API. To pull data, an agent spins up headless Chrome and waits, a total waste. This tool learns the network requests the site's own frontend makes, once, strips the cookies and turns it into a plain HTTP call. When the site changes, the first agent on the network repairs it and everyone else gets the updated schema for free.
- **[my-yt](https://github.com/christian-fei/my-yt):** Even if you pay for Premium, your attention belongs to the algorithm. This local interface, built on `yt-dlp` and SponsorBlock, fetches only the channels you subscribe to, in chronological order, cuts sponsor segments and removes clickbait thumbnails. It can even summarize a video with your local LLM before you watch it. And it's written with zero JS frameworks.
- **[TwinDesk](https://github.com/MorkMindy74/twindesk) & [Sapphire](https://github.com/cshariq/Sapphire):** Mac, PC and Android on one desk? TwinDesk merges them without the cloud, over a custom UDP protocol written in Rust; push the mouse off the Mac and it lands on the PC. Sapphire turns the Mac's notch into a control panel and a Nearby Share receiver.

---

Whether you're stepping onto a padel court for the first time in the November cold or building a new architecture locally, it's the same thing. **Cut the noise, keep your own alignment.**

If this bubble pops, what will the next one be? And which tab couldn't you bring yourself to close this week? Write to me, I read them all.

If you found this useful, send it to that friend who's still building a pitch deck that says "AI will change everything." See you next week.

---

*Sources (Huang section):* [CNBC, Nov 9](https://www.cnbc.com/2026/11/09/nvidia-jensen-huang-chinese-spy-investigation.html) · [CNBC, Nov 8](https://www.cnbc.com/2026/11/08/nvidia-jensen-huang-investigation-china-spy.html) · [Newsweek](https://www.newsweek.com/alice-huang-alleged-chinese-spy-affair-jensen-huang-12685860) · [Al Jazeera](https://aljazeera.com/news/2026/11/8/us-chipmaker-nvidia-investigates-ceo-jensen-huang-over-affair)
