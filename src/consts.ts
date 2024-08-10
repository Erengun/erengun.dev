import type { Site, Page, Links, Socials } from "@types"

// Global
export const SITE: Site = {
  TITLE: "Eren Gün",
  DESCRIPTION: "Hi, I'm Eren. I'm a software developer based in Istanbul, Turkey.",
  AUTHOR: "Eren Gün",
}

// Work Page
export const WORK: Page = {
  TITLE: "Work",
  DESCRIPTION: "Places I have worked.",
}

// Blog Page
export const BLOG: Page = {
  TITLE: "Blog",
  DESCRIPTION: "Writing on topics I am passionate about.",
}

// Projects Page 
export const PROJECTS: Page = {
  TITLE: "Projects",
  DESCRIPTION: "Recent projects I have worked on.",
}

// Search Page
export const SEARCH: Page = {
  TITLE: "Search",
  DESCRIPTION: "Search all posts and projects by keyword.",
}

// Links
export const LINKS: Links = [
  { 
    TEXT: "Home", 
    HREF: "/", 
  },
  { 
    TEXT: "Work", 
    HREF: "/work", 
  },
  { 
    TEXT: "Blog", 
    HREF: "/blog", 
  },
  { 
    TEXT: "Projects", 
    HREF: "/projects", 
  },
]

// Socials
export const SOCIALS: Socials = [
  { 
    NAME: "Email",
    ICON: "email", 
    TEXT: "hi@erengun.dev",
    HREF: "mailto:hi@erengun.dev",
  },
  { 
    NAME: "Github",
    ICON: "github",
    TEXT: "erengun",
    HREF: "https://github.com/erengun"
  },
  { 
    NAME: "LinkedIn",
    ICON: "linkedin",
    TEXT: "erengun",
    HREF: "https://www.linkedin.com/in/erengun/",
  },
  { 
    NAME: "Mastodon",
    ICON: "mastodon",
    TEXT: "erengun",
    HREF: "https://mastodon.social/@erengun",
  },
]

