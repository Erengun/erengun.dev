import type { APIRoute } from "astro"

const robotsTxt = `
User-agent: AI2Bot
User-agent: Ai2Bot-Dolma
User-agent: Amazonbot
User-agent: Applebot
User-agent: Applebot-Extended
User-agent: Bytespider
User-agent: CCBot
User-agent: ChatGPT-User
User-agent: Claude-Web
User-agent: ClaudeBot
User-agent: Diffbot
User-agent: FacebookBot
User-agent: FriendlyCrawler
User-agent: GPTBot
User-agent: Google-Extended
User-agent: GoogleOther
User-agent: GoogleOther-Image
User-agent: GoogleOther-Video
User-agent: ICC-Crawler
User-agent: ISSCyberRiskCrawler
User-agent: ImagesiftBot
User-agent: Kangaroo Bot
User-agent: Meta-ExternalAgent
User-agent: Meta-ExternalFetcher
User-agent: OAI-SearchBot
User-agent: PerplexityBot
User-agent: PetalBot
User-agent: Scrapy
User-agent: Sidetrade indexer bot
User-agent: Timpibot
User-agent: VelenPublicWebCrawler
User-agent: Webzio-Extended
User-agent: YouBot
User-agent: anthropic-ai
User-agent: cohere-ai
User-agent: facebookexternalhit
User-agent: iaskspider/2.0
User-agent: img2dataset
User-agent: omgili
User-agent: omgilibot
User-agent: 360Spider
User-agent: 360Spider-Image
User-agent: 360Spider-Video
# google.com landing page quality checks
User-agent: AdsBot-Google
User-agent: AdsBot-Google-Mobile
# google.com app resource fetcher
User-agent: AdsBot-Google-Mobile-Apps
# bing ads bot
User-agent: adidxbot
# apple.com search engine
User-agent: Applebot
user-agent: AppleNewsBot
# baidu.com chinese search engine
User-agent: Baiduspider
User-agent: Baiduspider-image
User-agent: Baiduspider-news
User-agent: Baiduspider-video
# bing.com international search engine
User-agent: bingbot
User-agent: BingPreview
# bublup.com suggestion/search engine
User-agent: BublupBot
# commoncrawl.org open repository of web crawl data
User-agent: CCBot
# cliqz.com german in-product search engine
User-agent: Cliqzbot
# coccoc.com vietnamese search engine
User-agent: coccoc
User-agent: coccocbot-image
User-agent: coccocbot-web
# daum.net korean search engine
User-agent: Daumoa
# dazoo.fr french search engine
User-agent: Dazoobot
# deusu.de german search engine
User-agent: DeuSu
# duckduckgo.com international privacy search engine
User-agent: DuckDuckBot
User-agent: DuckDuckGo-Favicons-Bot
# eurip.com european search engine
User-agent: EuripBot
# exploratodo.com latin search engine
User-agent: Exploratodo
# facebook.com social network
User-agent: facebookcatalog
User-agent: facebookexternalhit
User-agent: Facebot
# feedly.com feed fetcher
User-agent: Feedly
# findx.com european search engine
User-agent: Findxbot
# goo.ne.jp japanese search engine
User-agent: gooblog
# google.com international search engine
User-agent: Googlebot
User-agent: Googlebot-Image
User-agent: Googlebot-Mobile
User-agent: Googlebot-News
User-agent: Googlebot-Video
# so.com chinese search engine
User-agent: HaoSouSpider
# goo.ne.jp japanese search engine
User-agent: ichiro
# istella.it italian search engine
User-agent: istellabot
# jike.com / chinaso.com chinese search engine
User-agent: JikeSpider
# lycos.com & hotbot.com international search engine
User-agent: Lycos
# mail.ru russian search engine
User-agent: Mail.Ru
# google.com adsense bot
User-agent: Mediapartners-Google
# Preview bot for Microsoft products
User-agent: MicrosoftPreview
# mojeek.com search engine
User-agent: MojeekBot
# bing.com international search engine
User-agent: msnbot
User-agent: msnbot-media
# orange.com international search engine
User-agent: OrangeBot
# pinterest.com social networtk
User-agent: Pinterest
# botje.nl dutch search engine
User-agent: Plukkie
# qwant.com french search engine
User-agent: Qwantify
# rambler.ru russian search engine
User-agent: Rambler
# seznam.cz czech search engine
User-agent: SeznamBot
# soso.com chinese search engine
User-agent: Sosospider
# yahoo.com international search engine
User-agent: Slurp
# sogou.com chinese search engine
User-agent: Sogou blog
User-agent: Sogou inst spider
User-agent: Sogou News Spider
User-agent: Sogou Orion spider
User-agent: Sogou spider2
User-agent: Sogou web spider
# sputnik.ru russian search engine
User-agent: SputnikBot
# twitter.com social media bot
User-agent: Twitterbot
# whatsapp.com preview bot
User-agent: WhatsApp
# yacy.net p2p search software
User-agent: yacybot
# yandex.com russian search engine
User-agent: Yandex
User-agent: YandexMobileBot
# yep.com search engine
User-agent: YepBot
# search.naver.com south korean search engine
User-agent: Yeti
# yioop.com international search engine
User-agent: YioopBot
# yooz.ir iranian search engine
User-agent: yoozBot
# youdao.com chinese search engine
User-agent: YoudaoBot
# crawling rule(s) for above bots
Disallow: /
# disallow all other bots
User-agent: *
Disallow: /

Sitemap: ${new URL("sitemap-index.xml", import.meta.env.SITE).href}
`.trim()

export const GET: APIRoute = () => {
  return new Response(robotsTxt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}
