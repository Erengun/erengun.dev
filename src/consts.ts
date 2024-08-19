import type { Site, Page, Links, Socials } from "@types"

// Global
export const SITE: Site = {
  TITLE: "Fatih Cloud",
  DESCRIPTION: "Hi, I'm Fatih. I'm a software developer based in Ankara, Turkey.",
  AUTHOR: "Fatih Cloud",
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
    TEXT: "hi@fatihcloud.com",
    HREF: "mailto:hi@fatihcloud.com",
  },
  { 
    NAME: "Github",
    ICON: "github",
    TEXT: "Fatih Cloud",
    HREF: "https://github.com/Fatihcloud"
  },
  { 
    NAME: "LinkedIn",
    ICON: "linkedin",
    TEXT: "Fatih Cloud",
    HREF: "https://www.linkedin.com/in/fatihcloud/",
  },
]

