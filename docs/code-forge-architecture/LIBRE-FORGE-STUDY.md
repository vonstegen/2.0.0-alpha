# LIBRE FORGE — The Complete History of Version Control & Repository Hosting, and a Design for What Comes Next

**Author:** Linus (Review Oracle Subagent)
**Date:** 2026-05-21
**Classification:** L2 (Project) — DAO Reference Document
**Status:** Complete Study + Architectural Design

---

> *"I'm doing a (conditions conditions conditions) parsing thing because I need it. It's only two weeks old, and already it does some things better than anything out there."*
> — Linus Torvalds, April 7, 2005, announcing Git

---

## TABLE OF CONTENTS

1. [Part I: The Complete History of Version Control](#part-i-the-complete-history-of-version-control)
2. [Part II: The Repository Hosting Wars](#part-ii-the-repository-hosting-wars)
3. [Part III: The Betrayals & Lock-in Mechanisms](#part-iii-the-betrayals--lock-in-mechanisms)
4. [Part IV: The Decentralized Alternatives](#part-iv-the-decentralized-alternatives)
5. [Part V: Platform Grading](#part-v-platform-grading)
6. [Part VI: Design — LibreForge](#part-vi-design--libreforge)
7. [Part VII: What We Don't Build](#part-vii-what-we-dont-build)

---

# PART I: THE COMPLETE HISTORY OF VERSION CONTROL

## The Pre-History (1972–1990): When Files Were Just Files

### SCCS — Source Code Control System (1972)
- **Creator:** Marc Rochkind at Bell Labs
- **What it was:** The first real version control system. Single-file tracking. Lock-edit-unlock model.
- **Key innovation:** Interleaved deltas — stored all versions in a single file using a weaving technique. Remarkably space-efficient for 1972.
- **Fatal flaw:** Single-file only. No project-level versioning. Lock-based — one person edits at a time.
- **Legacy:** Proved the concept. Every VCS that followed owes SCCS for proving that tracking file history was worth doing.
- **Grade: C+** — Pioneering, but primitive by any modern standard.

### RCS — Revision Control System (1982)
- **Creator:** Walter Tichy at Purdue University
- **What it was:** SCCS but better. Reverse deltas (stored newest version complete, older versions as diffs backwards). Faster checkout of current version.
- **Key innovation:** Reverse delta storage — you almost always want the latest version, so store THAT complete and reconstruct old versions from diffs. Obvious in retrospect, revolutionary at the time.
- **Fatal flaw:** Still single-file. Still lock-based. No networking.
- **Legacy:** RCS keywords (`$Id$`, `$Revision$`) persisted in codebases for decades. Some sysadmins still use it for `/etc` tracking.
- **Grade: B-** — Solid engineering, right idea, wrong era.

### CVS — Concurrent Versions System (1990)
- **Creator:** Dick Grune (initial scripts, 1986), then Brian Berliner rewrote it as real software (1989-1990)
- **What it was:** RCS with networking and concurrent editing. The first VCS that let multiple people work on the same file simultaneously.
- **Key innovations:**
  - Client-server architecture (central repository, remote access)
  - Concurrent editing with merge-on-commit (goodbye lock-edit-unlock)
  - Project-level operations (commit across multiple files)
  - Branching and tagging
- **Fatal flaws:**
  - No atomic commits (if a multi-file commit failed halfway, you got a half-committed state)
  - No rename tracking (renaming a file = deleting old + creating new, history lost)
  - No directory versioning
  - Binary file handling was terrible
  - The codebase was a nightmare of accumulated hacks
- **Legacy:** Dominated the open-source world for over a decade. SourceForge ran on it. The Apache project, FreeBSD, and thousands of others used it. CVS trained an entire generation of developers in version control concepts.
- **Grade: B** — The right tool at the right time. Enabled the open-source movement. Aged terribly.

### Visual SourceSafe (1994)
- **Creator:** One Tree Software, acquired by Microsoft in 1994
- **What it was:** Microsoft's answer to version control. Integrated with Visual Studio.
- **Key innovation:** None. It was version control for Windows developers who didn't know Unix.
- **Fatal flaws:**
  - Legendary data corruption. "Visual SourceSafe" became synonymous with "lost my code."
  - Lock-based model in an era of concurrent editing
  - Shared folder architecture (the database was literally files in a shared Windows folder)
  - No real branching
  - Terrible performance over networks
- **Legacy:** Taught an entire generation of Windows developers to fear version control. Microsoft eventually killed it and replaced it with Team Foundation Server (now Azure DevOps).
- **Grade: D-** — Actively harmful to the industry. The fact that this was the default for Windows shops for a decade set version control adoption back years.

## The Second Generation (2000–2005): Getting Serious

### Apache Subversion / SVN (2000)
- **Creator:** CollabNet (Jim Blandy, Karl Fogel, Ben Collins-Sussman)
- **What it was:** "CVS done right." Explicitly designed to fix every CVS flaw while keeping the centralized model.
- **Key innovations:**
  - Atomic commits (all-or-nothing)
  - Directory versioning and rename tracking
  - Efficient binary file handling
  - HTTP-based access (WebDAV/DeltaV)
  - Properties on files and directories
  - Proper branching (cheap copies)
- **Fatal flaw:** Still centralized. The server was a single point of failure and a bottleneck. Branching was cheap but merging was painful (improved in later versions but never great). Offline work was impossible — you needed the server to commit, diff, or log.
- **Legacy:** Replaced CVS as the standard for centralized VCS. Still used by many organizations (including the Apache Foundation itself until they migrated to Git). Google used it internally for years.
- **Grade: B+** — Excellent engineering. Solved real problems. But the centralized model was a dead end.

### Perforce / Helix Core (1995)
- **Creator:** Christopher Seiwald
- **What it was:** Commercial, high-performance centralized VCS. The enterprise choice.
- **Key strengths:**
  - Blazing fast on huge repositories (millions of files)
  - Excellent binary/large file handling
  - Fine-grained access control
  - Atomic changelists
- **Fatal flaws:**
  - Expensive (enterprise pricing)
  - Proprietary
  - Centralized (same fundamental limitation as SVN)
  - Lock-based workflow common in practice
- **Legacy:** Still used in game development (Unreal Engine), large enterprises, and anywhere with massive binary assets. Google's internal system (Piper) was influenced by Perforce concepts.
- **Grade: B** — Good at what it does. Irrelevant to the open-source world.

### IBM Rational ClearCase (1992)
- **Creator:** Atria Software (acquired by Rational Software, then IBM)
- **What it was:** Enterprise version control taken to its logical extreme. Virtual filesystems, dynamic views, configurable workspaces.
- **Key innovation:** MVFS (Multi-Version File System) — the repository appeared as a virtual filesystem. You could `cd` into it and see any version of any file as if it were a regular directory.
- **Fatal flaws:**
  - Absurdly complex. Required dedicated administrators.
  - Glacially slow. Dynamic views over network were legendarily painful.
  - Hideously expensive (six-figure site licenses)
  - Lock-based by default
  - The learning curve was a cliff
- **Legacy:** A cautionary tale about overengineering. Proved that complexity is the enemy of adoption. Many organizations migrated away with visible relief.
- **Grade: D+** — Technically interesting, practically a disaster.

### BitKeeper (2000)
- **Creator:** Larry McVoy, BitMover Inc.
- **What it was:** The first serious distributed VCS. Revolutionary technology, catastrophic politics.
- **Key innovations:**
  - True distributed model — every developer has a complete repository
  - Efficient peer-to-peer synchronization
  - Changeset-oriented (not file-oriented)
  - Content tracking across renames
- **The Linux Kernel Story:**
  - 2002: Linus Torvalds adopted BitKeeper for Linux kernel development
  - Controversial: Richard Stallman and Alan Cox objected to using proprietary tools for a free software flagship
  - BitMover provided free "community" licenses with restrictions: you couldn't work on competing VCS tools, and metadata was sent to BitMover's servers
  - April 2005: Andrew Tridgell (of Samba fame), employed by OSDL, reverse-engineered the BitKeeper metadata protocol. Larry McVoy revoked the free community license for ALL OSDL employees, including Linus Torvalds and Andrew Morton.
  - **This is the moment that created Git.**
  - BitMover went open-source (Apache 2.0) in 2016. Too late. BitKeeper is now discontinued.
- **Grade: A- (technology), F (business/community)** — Proved the distributed model worked. Then imploded due to the exact vendor lock-in that free software advocates had warned about.

## The Distributed Revolution (2005–2010)

### Git (2005)
- **Creator:** Linus Torvalds
- **Origin story:** After the BitKeeper debacle, Torvalds wrote Git in approximately two weeks. First commit: April 7, 2005. Self-hosting by April 2005. Linux kernel migrated to Git by June 2005.
- **Design principles (Torvalds' own words):**
  1. Take CVS as an example of what NOT to do. If in doubt, make the exact opposite decision.
  2. Support a distributed workflow
  3. Very strong safeguards against corruption (SHA-1 hashing of everything)
  4. Very high performance
- **Key innovations:**
  - Content-addressable storage (everything is a SHA-1 hash)
  - Snapshots, not deltas (each commit stores a complete snapshot of all tracked files, with deduplication)
  - Branches are just pointers (creating a branch = writing 41 bytes to a file)
  - The staging area (index) — a unique intermediate step between working directory and committed history
  - Extremely fast branching and merging
  - Completely distributed — no server required
- **Strengths:**
  - Speed (orders of magnitude faster than SVN for most operations)
  - Cheap branching enables workflows impossible with centralized VCS
  - Cryptographic integrity (every commit is a hash of its contents + parent hashes)
  - Total flexibility in workflow (centralized, feature-branch, fork-and-pull, etc.)
  - De facto standard — universal tooling support
- **Weaknesses:**
  - Steep learning curve (the UI is notoriously hostile)
  - Poor large binary file handling (addressed by Git LFS, but bolted-on)
  - History rewriting (rebase, force push) can cause data loss if misused
  - SHA-1 is cryptographically broken (migration to SHA-256 is slow and painful)
  - The index/staging area confuses beginners
  - Monorepo support is weak compared to Perforce (though improving with sparse checkout, partial clone)
- **Legacy:** Won. Completely, totally, overwhelmingly won. Git is the VCS for >95% of all software development worldwide. Everything else is a rounding error.
- **Grade: A** — Changed the world. Imperfect, but the right tradeoffs at the right time.

### Mercurial / hg (2005)
- **Creator:** Olivia Mackall (formerly Matt Mackall)
- **Origin:** Created the same month as Git, for the same reason (BitKeeper fallout). Olivia was a Linux kernel contributor.
- **Philosophy:** Distributed like Git, but user-friendly. Where Git exposed internals, Mercurial hid complexity.
- **Key strengths:**
  - Clean, consistent command-line interface
  - Written in Python (more accessible codebase than Git's C)
  - Revlogs (efficient delta storage format)
  - Extensions system for customization
- **What happened:** Lost the adoption war to Git. Key moments:
  - 2008: GitHub launched (Git-only). No equivalent Mercurial hosting emerged.
  - 2011: Google Code added Git support alongside Mercurial
  - 2014: Facebook chose Mercurial for their monorepo (custom extensions), but this was an exception
  - 2015: Google Code shut down
  - 2020: Bitbucket (the last major Mercurial host) dropped Mercurial support
- **Legacy:** Better UX than Git, but network effects won. Facebook's Sapling VCS descends from their Mercurial customizations.
- **Grade: B+** — Superior user experience, inferior ecosystem. A tragedy of network effects.

### Bazaar / bzr (2005)
- **Creator:** Canonical (Ubuntu's parent company)
- **What it was:** Distributed VCS backed by a corporation. Used for Ubuntu/Launchpad development.
- **What happened:** Canonical abandoned it in 2012 in favor of Git. The project is effectively dead. Breezy is a community fork that limps along.
- **Grade: C** — Corporate backing without community momentum = death.

### Darcs (2003)
- **Creator:** David Roundy
- **What it was:** VCS based on patch theory (the "theory of patches"). Written in Haskell.
- **Key innovation:** Patches are the fundamental unit, not snapshots or deltas. Patches can be reordered, cherry-picked, and composed in mathematically principled ways.
- **Fatal flaw:** Exponential merge conflicts. In pathological cases, merging could take exponential time. This was the "Darcs merge problem."
- **Legacy:** Inspired Pijul's more rigorous patch theory.
- **Grade: C+** — Beautiful theory, impractical reality.

## The Modern Era (2010–Present)

### Fossil (2006, but relevant now)
- **Creator:** D. Richard Hipp (creator of SQLite)
- **What it is:** An all-in-one DVCS + bug tracker + wiki + forum + web interface, stored in a single SQLite database file.
- **Philosophy:** "Cathedral" vs. Git's "Bazaar." Fossil is opinionated: it believes all project artifacts (code, bugs, docs, discussions) should live together.
- **Key strengths:**
  - Single binary, single database file, zero configuration
  - Built-in web interface (run `fossil ui` and you have a full forge)
  - Autosync mode (can behave like centralized VCS)
  - All content in an SQLite DB = atomic transactions, corruption resistance
  - Self-hosting: Fossil hosts its own development. SQLite hosts its development in Fossil.
  - BSD license
- **Weaknesses:**
  - Small community (intentionally)
  - Not Git-compatible (different data model)
  - No ecosystem of third-party tools
  - Anti-rebase philosophy (Fossil is philosophically opposed to history rewriting)
- **Grade: B+** — The most intellectually honest VCS alive. If you value simplicity, integrity, and self-sufficiency over ecosystem, Fossil is the answer. Severely underappreciated.

### Pijul (2015–present)
- **Creator:** Pierre-Étienne Meunier
- **What it is:** VCS based on a sound mathematical theory of patches (category theory). Written in Rust.
- **Key innovation:** Patches commute when they don't conflict. This means merge order doesn't matter — the same patches applied in any order produce the same result. Git cannot guarantee this.
- **Current state:** Usable but immature. The Nest (pijul.com hosting) exists but has minimal adoption.
- **Grade: C+** — Mathematically superior, practically irrelevant (so far).

### Jujutsu / jj (2022–present)
- **Creator:** Martin von Zweigbergk at Google
- **What it is:** A new VCS frontend that uses Git as a storage backend. "Git-compatible but with a better UI and model."
- **Key innovations:**
  - Working copy is automatically tracked (no staging area)
  - Conflicts are first-class objects (you can commit conflicted state)
  - Anonymous branches by default
  - Operation log (undo ANY operation, not just commits)
  - Stacked diffs workflow built-in
- **Current state:** Growing rapidly. Google is using it internally. Compatible with existing Git repos.
- **Grade: B+** — The most promising "Git successor" approach: don't replace Git's plumbing, replace its porcelain.

### Sapling (2022–present)
- **Creator:** Meta (Facebook)
- **What it is:** Meta's internal VCS (evolved from their heavily-modified Mercurial) released as open source.
- **Key strengths:** Designed for massive monorepos. Virtual filesystem integration. Stacked diffs. Smart pull (download only what you need).
- **Current state:** Open source but heavily tied to Meta's infrastructure. Limited community adoption outside Meta.
- **Grade: C+** — Impressive engineering for Meta's problems. Not a general-purpose solution.

---

# PART II: THE REPOSITORY HOSTING WARS

## SourceForge (1999–2013, decline)

### The Rise
- Founded 1999 by VA Software (Tony Guntharp, Uriah Welcome, Tim Perdue, Drew Streib)
- **The original.** First platform to offer free hosting for open-source projects.
- Peak era: 2000–2008. If you were an open-source project, you were on SourceForge.
- Hosted everything: GIMP, FileZilla, 7-Zip, VLC, Audacity, PuTTY, MinGW, and hundreds of thousands more.
- Revenue: Banner ads. Quarterly revenue grew from $1M (2005) to $23M (2009).

### The Fall
- **2012:** Acquired by Dice.com (online job site) for $20M alongside Slashdot and Freecode. Already a sign of decline — the crown jewel of open source sold for pocket change.
- **2013 — THE BETRAYAL:** SourceForge launched "DevShare" — a program that wrapped open-source downloads in proprietary adware installers. The installer would bundle toolbars, change browser settings, and install unwanted software unless users carefully clicked through opt-out screens.
- **2013:** GIMP pulled their download from SourceForge, citing "misleading download buttons."
- **2014:** SourceForge escalated: they began taking over ABANDONED projects and wrapping their downloads in adware WITHOUT the developers' consent. The GIMP for Windows project (which had been abandoned on SourceForge after migrating) had its downloads hijacked by SourceForge and served with adware wrappers.
- **2014-2015:** Nmap, VLC, and other projects publicly condemned SourceForge.
- **2015:** The bundleware scandal became a major tech news story. SourceForge's reputation was destroyed.
- **2016:** Sold again to BIZX LLC (later rebranded to Slashdot Media). New owners eliminated the DevShare program and attempted a reputation rehabilitation.
- **Current state:** Technically still online (~502,000 projects, 3.7M users as of 2020). Mostly a software comparison/review directory now. Nobody starts a new project there.

### Verdict
- **Grade: D** — Pioneered the space, then committed the cardinal sin: exploiting the trust of the open-source community for short-term ad revenue. The adware installer wrapping was a betrayal of the implied contract between a hosting platform and its users. SourceForge's corpse is a monument to what happens when a platform's commercial interests diverge from its community's interests.

## Google Code (2006–2016)

### The Rise
- Launched 2006 by Google as a free project hosting service.
- Supported SVN, Mercurial, and (later) Git.
- Clean interface. Fast. Reliable. It was Google.

### The Fall
- Never gained critical mass. GitHub launched two years later and ate its lunch.
- Google lost interest (as Google does with products that aren't #1).
- **2015:** Google announced Google Code was shutting down. All projects given migration tools (mostly to GitHub or Bitbucket).
- **2016:** Read-only archive. Then fully shut down.

### Verdict
- **Grade: C** — Competent but uninspired. Google treated it as a side project and killed it when it didn't win. The shutdown proved the danger of depending on a corporation's hosting: when the corporation loses interest, your platform evaporates.

## GitHub (2008–present)

### The Rise
- **Founded:** February 8, 2008 by Tom Preston-Werner, Chris Wanstrath, P.J. Hyett, and Scott Chacon. Originally "Logical Awesome LLC."
- **Launched:** April 10, 2008.
- **Innovation:** Turned Git (a command-line tool for kernel hackers) into a social platform for all developers. The key insight: make forking and pull requests trivially easy, and make profiles visible (contribution graphs, stars, followers).
- **Bootstrapped:** Profitable from the start. No VC money for four years.
- **Growth:**
  - 2009: 100K users
  - 2011: 1M users
  - 2012: $100M investment from Andreessen Horowitz at $750M valuation
  - 2013: 3M users
  - 2015: $250M Series B at $2B valuation
  - 2018: 28M users at time of Microsoft acquisition
  - 2023: 100M+ developers, 420M+ repositories
  - 2025: 150M users

### The Controversies (Pre-Microsoft)
- **2014: Tom Preston-Werner firing.** Co-founder and CEO accused of harassment. His wife Theresa also accused of creating a hostile work environment. Investigation found no legal wrongdoing but Preston-Werner resigned. This ended GitHub's flat-organization experiment and introduced middle management.
- **2015: GitHub's culture problems.** Former employees described a bro-culture environment. The flat organization meant no accountability structures.

### The Microsoft Acquisition (2018)
- **Announced:** June 4, 2018
- **Price:** $7.5 billion in Microsoft stock
- **CEO:** Nat Friedman (Microsoft VP) replaced Chris Wanstrath as CEO. Later replaced by Thomas Dohmke (2021–present).
- **Community reaction:** Panic. Mass migrations threatened (many to GitLab, which saw 10x signups the day of the announcement). Microsoft had spent decades attacking open source ("Linux is a cancer" — Steve Ballmer, 2001). The fox was buying the henhouse.
- **What actually happened:**
  - Free private repos for everyone (previously paid)
  - GitHub Actions (CI/CD) launched
  - GitHub Codespaces (cloud dev environments)
  - GitHub Copilot (AI code assistant)
  - npm acquired (2020) — JavaScript package ecosystem
  - Revenue: $1 billion by 2022
  - The mass migration never materialized. GitHub's network effect was too strong.

### The Real Problem: Lock-in By Comfort
Microsoft didn't need to make GitHub worse. They made it *more convenient*:
- **GitHub Actions:** CI/CD tightly integrated with GitHub repos. Migrating away means rewriting all your CI pipelines.
- **GitHub Pages:** Free static hosting tied to GitHub repos.
- **GitHub Packages:** Package registry tied to GitHub repos.
- **GitHub Codespaces:** Cloud development environments launched from GitHub repos.
- **GitHub Copilot:** AI assistant trained on GitHub-hosted code, sold as a GitHub subscription.
- **npm:** The JavaScript ecosystem's package manager, owned by GitHub/Microsoft.

Each feature makes it harder to leave. None of them are open standards. All of them are proprietary services that only work within GitHub's ecosystem.

### The Copilot Controversy
- GitHub Copilot was trained on public GitHub repositories — including GPL-licensed code.
- The GPL requires that derivative works be released under the GPL. Copilot generates code that is functionally derived from GPL code but is sold as a proprietary subscription product.
- **2022:** Software Freedom Conservancy launched "Give up GitHub" campaign, specifically citing Copilot's training on copyleft-licensed code as a violation of developers' rights.
- **2022:** A class-action lawsuit (Doe v. GitHub) was filed alleging copyright infringement, DMCA violations, and breach of open-source licenses. The case was partially dismissed but key claims survived.
- **GitHub's position:** Copilot outputs are "transformative" and not copies of the training data. (This is the same argument used by every generative AI company and has not been definitively tested in court as of 2026.)
- **2025-2026 exodus begins:** Zig programming language moved to Codeberg. Gentoo announced presence on Codeberg, citing GitHub's aggressive Copilot push. Dillo founder left citing GitHub's "over-focusing on LLMs and generative AI."

### Verdict
- **Grade: B+ (product), D (trust)**
- As a product, GitHub is excellent. The UX is polished, the features are comprehensive, the network effect is overwhelming.
- As a trustworthy steward of the open-source commons, GitHub fails. It is a proprietary platform owned by one of the largest corporations in history. It trained an AI on its users' code without meaningful consent and sells the output as a subscription. It uses its dominant position to create lock-in through convenience.
- **The fundamental problem:** 150 million developers have entrusted their code to a subsidiary of Microsoft. If Microsoft's interests ever diverge from developers' interests (and with Copilot, they already have), developers have no recourse except to leave — which GitHub's lock-in makes increasingly difficult.

## GitLab (2011–present)

### History
- **Created:** 2011 by Ukrainian developer Dmytro Zaporozhets as a side project in Ruby on Rails.
- **Business model:** Open-core. Community Edition (MIT license) is genuinely open source. Enterprise Edition is source-available proprietary.
- **IPO:** 2021, Nasdaq under ticker GTLB.
- **2024:** Co-founder/CEO Sybren Sijbrandij stepped down for cancer treatment. Bill Staples became CEO.

### Strengths
- Self-hostable (the Community Edition is real, usable software)
- Comprehensive DevOps platform (CI/CD, container registry, monitoring, security scanning — all built-in)
- Transparent company (public handbook, all-remote culture)
- European roots (Dutch company)

### Weaknesses
- **Open-core tension:** The best features are Enterprise-only. The free tier is usable but the upgrade pressure is constant.
- **Complexity:** GitLab CE is heavy. Running it requires significant resources (official recommendation: 8GB+ RAM).
- **Corporate trajectory:** As a public company, GitLab is under pressure to maximize revenue. The tendency to move features from CE to EE (or to create new features exclusively in EE) is real and ongoing.
- **Not truly free:** The Community Edition is free-as-in-speech, but the hosted version (gitlab.com) has aggressive tier limitations.

### Verdict
- **Grade: B** — The best corporate option. The open-core model is honest (you can see exactly what's free and what isn't). Self-hosting works. But it's still a publicly-traded company with shareholders to satisfy, and the trajectory is toward more paywalling, not less.

## Bitbucket (2008–present)

### History
- **Founded:** 2008 by Jesper Nøhr as a Mercurial hosting platform.
- **2010:** Acquired by Atlassian for an undisclosed amount.
- **Key integration:** Part of the Atlassian ecosystem (Jira, Confluence, Trello).

### The Mercurial Betrayal
- **2020:** Bitbucket dropped all Mercurial support. All Mercurial repositories were deleted.
- This was the death blow for Mercurial as a viable ecosystem. The last major hosting platform for Mercurial simply erased it.
- Developers who had chosen Mercurial on Bitbucket because Bitbucket supported Mercurial were left scrambling to convert their repos to Git and migrate.

### Verdict
- **Grade: C-** — An adequate platform with no identity of its own. Exists primarily as a Jira integration point. The Mercurial deletion was a betrayal of the developers who chose Bitbucket specifically for Mercurial support. Atlassian treated those users as acceptable losses.

## Gitea (2016–present) & Forgejo (2022–present)

### Gitea
- **Origin:** Forked from Gogs (Go Git Service) in 2016 due to Gogs' single-maintainer bottleneck.
- **What it is:** Lightweight, self-hosted Git forge written in Go. Single binary deployment.
- **The controversy:** In 2022, lead maintainer Lunny Xiao silently transferred Gitea's trademarks and operations to a for-profit company (Gitea Ltd). Contributors signed an open letter demanding the trademarks be placed under community governance. The request was rejected.

### Forgejo
- **Origin:** Forked from Gitea in December 2022 in direct response to Gitea's corporate capture.
- **Governance:** Community-governed under Codeberg e.V. (German nonprofit).
- **License:** Moved from MIT to GPLv3 in August 2024 (new code is GPL; original MIT code retains its license).
- **Key feature: Federation.** Forgejo is implementing ForgeFed (ActivityPub-based federation protocol). As of 2025, federated "stars" across instances work. This is the most important development in forge software in a decade.
- **Split from Gitea:** February 2024, Forgejo stopped syncing with Gitea's codebase, becoming a fully independent project.

### Verdict
- **Gitea Grade: C+** — Good software, bad governance. The corporate capture proved that even community projects can be hijacked by a single maintainer.
- **Forgejo Grade: A-** — The correct response to Gitea's betrayal. Nonprofit governance, GPL license, federation roadmap. The most promising self-hosted forge software available today.

## Codeberg (2018–present)

### What It Is
- **Organization:** Codeberg e.V., a German registered nonprofit (eingetragener Verein).
- **Founded:** September 2018, launched January 2019.
- **Infrastructure:** EU-based servers (deliberate choice to avoid US DMCA jurisdiction).
- **Software:** Runs Forgejo. Codeberg is the de facto lead maintainer of Forgejo.
- **Cost:** Free. Funded by membership dues and donations.
- **Stats (Nov 2025):** 300,000+ repos, 200,000+ users, 1,208 members.
- **Operating expenses:** ~€1,050/month (2022). 2 part-time staff (2025).

### Notable Migrations TO Codeberg (2025-2026)
- **Zig:** Programming language migrated from GitHub. Reason: "GitHub no longer demonstrates commitment to engineering excellence."
- **Gentoo Linux:** Announced Codeberg presence. Reason: GitHub's attempts to force Copilot usage.
- **Dillo:** Browser project migrated. Reason: GitHub's "over-focusing on LLMs and generative AI."

### Verdict
- **Grade: A** — The closest thing to a trustworthy forge that currently exists. Nonprofit governance. EU jurisdiction. Open-source software (Forgejo). Community-funded. No ads, no tracking, no AI training on your code. The only weakness is scale — Codeberg has 200K users vs. GitHub's 150M. Whether it can scale is an open question.

## SourceHut / sr.ht (2018–present)

### What It Is
- **Creator:** Drew DeVault
- **Philosophy:** Minimalism. Email-based workflows. No JavaScript required. Patches over pull requests.
- **Business model:** Paid subscriptions (currently in alpha, which is free).
- **Stack:** Custom-built. Python. PostgreSQL. No frameworks.

### Strengths
- Fastest forge on the internet (pages load in milliseconds)
- Email-native: send patches via `git send-email`, review via mailing lists
- No JavaScript required for basic use
- Supports Git AND Mercurial
- CI/CD (builds.sr.ht) supports multiple operating systems and architectures
- Fully open source (AGPL)

### Weaknesses
- The email-based workflow is hostile to developers raised on pull requests
- Small community (~36K users as of 2023)
- Drew DeVault is a controversial figure; the project is heavily identified with one person
- The UX is intentionally spartan — this is a feature and a bug

### Verdict
- **Grade: B+** — The principled choice. If you believe software development should be done with email and patches (the way the Linux kernel still does it), SourceHut is the answer. But its opinionated workflow limits adoption. Not everyone wants to be a kernel hacker.

## Radicle (2018–present)

### What It Is
- **What:** An open-source, peer-to-peer code collaboration stack built on Git.
- **Architecture:** Fully decentralized. No servers. Repositories are replicated across peers using a gossip protocol. Cryptographic identities (Ed25519 keys) for users.
- **Protocol:** Custom gossip protocol + NoiseXK for encrypted peer communication.
- **Storage:** Everything in Git. Issues, patches, and social artifacts are stored as Git objects ("Collaborative Objects" / COBs).
- **Network:** Seed nodes provide availability (like BitTorrent seeders). Anyone can run a seed node.
- **Current version:** 1.9.0 (May 2026). Has Desktop client.
- **License:** MIT + Apache 2.0.

### Strengths
- True sovereignty: your data, your node, your keys
- No account required on any service
- Censorship-resistant (no central server to block)
- Local-first (works offline)
- Cryptographic authenticity for all data
- Extensible via Collaborative Objects

### Weaknesses
- Tiny community
- UX is still rough (improving with Desktop client)
- Discovery/discoverability is a problem (how do you find projects?)
- No built-in CI/CD (though blog posts describe using GitHub Actions as a bridge — ironic)
- Performance with large repos untested at scale

### Verdict
- **Grade: B+** — The technically correct answer. Radicle is what a forge looks like when you design for sovereignty first. But "technically correct" doesn't win adoption wars. The UX gap between Radicle and GitHub is still too large for most developers.

## Fossil SCM (as a forge)

Fossil was covered in Part I, but it deserves mention as a hosting alternative: Fossil IS a forge. A single binary gives you VCS + issue tracker + wiki + forum + web UI. SQLite hosts its own development in Fossil. D. Richard Hipp runs his own Fossil instance and has no dependency on any third-party hosting platform.

### Verdict (as forge)
- **Grade: B** — Perfect for small teams and individuals who want total self-sufficiency. Zero external dependencies. But not Git-compatible, which is a dealbreaker for most.

---

# PART III: THE BETRAYALS & LOCK-IN MECHANISMS

## The Betrayal Pattern

Every betrayal follows the same pattern:

```
1. Build platform → Attract community → Become indispensable
2. Platform economics change → New ownership or new incentives
3. Community's interests diverge from platform's interests
4. Platform chooses its interests → Community gets burned
```

### Catalog of Betrayals

| Platform | Year | Betrayal | Severity |
|----------|------|----------|----------|
| **SourceForge** | 2013-2015 | Adware bundling in downloads; hijacking abandoned projects | 🔴 CRITICAL |
| **BitKeeper** | 2005 | Revoked free licenses over reverse-engineering | 🔴 CRITICAL |
| **GitHub** | 2021-present | Training Copilot on GPL code without consent; selling output | 🟡 HIGH |
| **Bitbucket** | 2020 | Deleted all Mercurial repositories | 🟡 HIGH |
| **Google Code** | 2015 | Shut down entirely | 🟡 HIGH |
| **Gitea** | 2022 | Corporate capture of community project | 🟠 MEDIUM |
| **GitLab** | Ongoing | Progressive paywalling of CE features | 🟡 LOW-MEDIUM |

## Lock-in Mechanisms (GitHub)

GitHub's lock-in is the most sophisticated because it doesn't feel like lock-in:

| Mechanism | What It Does | Migration Cost |
|-----------|-------------|----------------|
| **GitHub Actions** | CI/CD workflows in YAML files specific to GitHub | Rewrite all CI pipelines |
| **GitHub Pages** | Free static hosting from repos | Find new hosting, update DNS |
| **GitHub Packages** | Package registry (npm, Docker, Maven, etc.) | Migrate all package publishing |
| **GitHub Codespaces** | Cloud dev environments | Lose dev environment configs |
| **GitHub Projects** | Project management boards | Migrate all project tracking |
| **GitHub Discussions** | Forum tied to repos | Lose community discussions |
| **GitHub Copilot** | AI assistant trained on GitHub data | Lose AI tooling integration |
| **npm** | THE JavaScript package manager | npm is GitHub-owned; packages tied to GitHub auth |
| **Stars/Followers** | Social proof metrics | Lose discoverability signals |
| **Contribution Graph** | Year of green squares = developer identity | Lose professional signaling |
| **GitHub Sponsors** | Funding mechanism for OSS developers | Lose income stream |

**Total cost of leaving GitHub for a mature project:** Weeks to months of work. For most teams, it's not worth it. That's the lock-in.

## The Social Network Trap

The most insidious lock-in is social, not technical:
- **Stars** = social proof that your project matters
- **Contribution graph** = your developer resume
- **Followers** = your audience
- **GitHub profile** = your professional identity as a developer

GitHub turned version control into a social network. And like all social networks, the value is in the network, not the software. You can migrate your code to Codeberg. You can't migrate your 10,000 stars or your contribution history.

## Terms of Service

GitHub's ToS (Section D) grants GitHub:
- A license to host, store, display, and run your content
- The right to parse/analyze content for service improvement
- A license to create "derivative works" as necessary for the service

This is standard hosting ToS language, but combined with Copilot, "derivative works for service improvement" takes on new meaning.

---

# PART IV: THE DECENTRALIZED ALTERNATIVES

## ForgeFed (ActivityPub Federation for Forges)

- **What:** An ActivityPub extension protocol for federating software forges.
- **How it works:** Like email but for code collaboration. Users on different servers can interact (open issues, submit pull requests, star repos) without creating accounts on each server.
- **Status:** Active development. Forgejo is implementing it. Vervis is the reference implementation. GitLab has begun exploratory work. NLnet-funded.
- **Promise:** The answer to GitHub's lock-in. If forges federate, no single platform has monopoly power. You host your code wherever you want and still collaborate with everyone.
- **Reality check:** Federation is hard. Email federation works because email is simple. Code collaboration involves complex state (branches, pull requests, CI results, reviews). Implementing all of this over ActivityPub is a multi-year effort.
- **Grade: A (concept), C+ (current state)** — The single most important project in the forge ecosystem. If it succeeds, it breaks GitHub's monopoly structurally, not just by offering an alternative.

## Radicle (Peer-to-Peer)

Covered in Part II. Key distinction from ForgeFed: Radicle is peer-to-peer (no servers at all), while ForgeFed federates servers. Both decentralize; they decentralize differently.

## IPFS-Based Approaches

Several projects have explored using IPFS (InterPlanetary File System) for code hosting:
- **git-remote-ipfs:** Git remote helper that stores objects on IPFS
- **Fleek:** Decentralized web hosting that could host static forge UIs
- **Current state:** Experimental. IPFS's garbage collection and pinning economics make reliable long-term storage difficult.
- **Grade: D** — Technically interesting, practically unusable for serious development.

## The Spectrum of Decentralization

```
Centralized                                              Decentralized
    |                                                         |
 GitHub    GitLab    Codeberg    ForgeFed     Radicle      Fossil
 (corp)    (corp)    (nonprofit) (federated)  (p2p)        (individual)
```

Each point on the spectrum trades convenience for sovereignty. The design challenge is: can we get Radicle's sovereignty with GitHub's convenience?

---

# PART V: PLATFORM GRADING

## Comprehensive Scorecard

| Platform | Trust | Freedom | UX | Self-Hosted | Federation | Git Compat | Community | Lock-in Risk | **OVERALL** |
|----------|-------|---------|----|-----------  |------------|------------|-----------|-------------|-------------|
| **GitHub** | D | D | A | N/A | F | A | A | F | **C** |
| **GitLab CE** | B | B+ | B+ | A | D | A | B | C | **B** |
| **Codeberg** | A | A | B | N/A* | C+ | A | B- | A | **A-** |
| **Forgejo** | A | A | B | A | B- | A | B- | A | **A-** |
| **SourceHut** | A | A | C+ | A | D | A | C | A | **B+** |
| **Radicle** | A+ | A+ | C | A+ | A (p2p) | A | D+ | A+ | **B+** |
| **Fossil** | A | A | B- | A+ | D | F | D | A+ | **B** |
| **Bitbucket** | C | C | B | C | F | A | C | D | **C-** |
| **SourceForge** | F | D | C | N/A | F | B | D | C | **D** |

*Codeberg is hosted by a nonprofit; self-hosting means running your own Forgejo instance.

### Grading Rubric
- **Trust:** Can you trust this platform not to betray you?
- **Freedom:** Is the platform itself free software? Can you leave easily?
- **UX:** How good is the daily developer experience?
- **Self-Hosted:** Can you run it yourself with reasonable effort?
- **Federation:** Can instances talk to each other?
- **Git Compat:** Does it work with standard git?
- **Community:** Size and health of the community
- **Lock-in Risk:** How hard is it to leave?

---

# PART VI: DESIGN — LIBREFORGE

## The Name

**LibreForge** — *Libre* (free as in freedom, from the Spanish/French) + *Forge* (where tools are made).

Alternative considered: **SovereignForge**, **OpenAnvil**, **FreeSmith**. LibreForge wins because:
- "Libre" is unambiguous (unlike "free" which can mean gratis)
- "Forge" is the established term for code collaboration platforms
- It's easy to say, easy to remember, easy to spell
- Domain: `libreforge.org` (or `.net`)
- Identity: A simple anvil icon. No mascots, no cutesy branding.

## Core Principles

1. **Truly free** — Not "free tier" free. Actually free. Forever. The software is GPL. The hosted service is donation-funded. There is no paid tier. There is no "enterprise edition." If you want features, contribute them.

2. **Non-invasive** — No telemetry. No tracking. No analytics cookies. No AI training on hosted code. No "anonymous usage data." The platform knows what it needs to function (git objects, user accounts, issue text) and nothing else.

3. **Non-intrusive** — Does one thing well: host code and enable collaboration. No social network features. No gamification. No contribution graphs. No stars leaderboards. Your code is not content for an engagement algorithm.

4. **Easy to trust** — Open source (AGPL-3.0 for the server, GPL-3.0 for clients). Transparent governance (DAO). Auditable finances. No corporate owner. Can never be acquired because there's nothing to acquire.

5. **Easy to use** — If it's harder than GitHub, it fails. This is the constraint that matters most. Every decentralized alternative has failed on UX. We will not.

6. **DAO-compatible** — Governance on-chain. Contribution tracking transparent. Treasury management via multisig. Proposals and votes verifiable.

7. **Sovereignty-first** — Self-hostable. Federated. Your data is YOUR data. You can export everything at any time in standard formats. Migration is a first-class feature, not an afterthought.

8. **Git-compatible** — Standard git. `git clone`, `git push`, `git pull`. No custom clients required. Existing Git workflows work unchanged.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACE                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Web UI   │  │ CLI (git +   │  │ Desktop Client    │  │
│  │ (clean,  │  │ forge-cli)   │  │ (optional, Tauri) │  │
│  │ fast)    │  │              │  │                   │  │
│  └──────────┘  └──────────────┘  └───────────────────┘  │
├─────────────────────────────────────────────────────────┤
│                    FORGE LAYER                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Issues │ Pull Requests │ Code Review │ CI Hooks │   │
│  │  Wiki   │ Releases     │ Webhooks    │ API      │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                 FEDERATION LAYER                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ForgeFed (ActivityPub) ←→ Other Instances       │   │
│  │  + Radicle bridge (optional p2p fallback)        │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                  IDENTITY LAYER                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  DID (Decentralized Identity)                    │   │
│  │  ← Optional: Ed25519 keys, Solana wallet link    │   │
│  │  ← Portable: take your identity to any instance  │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                   STORAGE LAYER                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Git (standard) + SQLite (metadata/issues/wiki)  │   │
│  │  + Optional: PostgreSQL for large instances       │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                 GOVERNANCE LAYER                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  DAO (Solana) — proposals, votes, treasury       │   │
│  │  Contribution tracking → on-chain reputation     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Component Design

### 1. Forge Core (The Server)

**Language:** Rust (performance, safety, single binary deployment)
**Inspiration:** Take the best from each:
- Forgejo's feature completeness
- Fossil's single-binary simplicity
- SourceHut's speed
- Radicle's cryptographic identity model

**Requirements:**
- Single binary deployment (download → run → done)
- Default storage: SQLite (zero config) with PostgreSQL option for scale
- Git over SSH + HTTPS (standard protocols)
- REST + GraphQL API
- WebSocket for real-time updates
- Memory footprint: <256MB for small instances

**Key Design Decisions:**
- **No ORM.** Raw SQL with prepared statements. ORMs are complexity for no gain.
- **No JavaScript frameworks for the server-rendered UI.** HTML + CSS + minimal JS. Pages load fast because they're small.
- **Progressive enhancement.** The core UI works without JavaScript. JS enhances but is never required for basic operations.
- **Flat file export.** At any time, `libreforge export` dumps your entire instance (repos, issues, wiki, users) to a directory of standard formats (git repos, markdown files, JSON metadata). No lock-in, by design.

### 2. Federation Protocol

**Base:** ForgeFed (ActivityPub extension)

**How it works in practice:**
```
Alice@forge-a.org wants to contribute to Bob@forge-b.org's project:

1. Alice finds Bob's project (via web, search, or direct link)
2. Alice forks the repo to her forge-a.org instance (federation message)
3. Alice pushes changes to her fork on forge-a.org
4. Alice opens a "Merge Request" from forge-a.org → forge-b.org (ActivityPub)
5. Bob receives the MR on forge-b.org, reviews, comments
6. Comments and review state sync bidirectionally via ActivityPub
7. Bob merges. Done.
```

**Alice never created an account on forge-b.org.** She used her identity from forge-a.org, just like sending an email.

**Federation scope (v1):**
- Cross-instance forking
- Cross-instance merge/pull requests
- Cross-instance issue creation and comments
- Cross-instance user identity resolution (DIDs)
- Repository mirroring/following

**Federation scope (v2, later):**
- Federated CI (trigger builds on remote instances)
- Federated search (discover projects across the network)
- Federated releases (announce releases across instances)

### 3. Identity System

**Problem:** GitHub's identity is GitHub's identity. You can't take your GitHub profile to GitLab.

**Solution:** Decentralized Identifiers (DIDs)

```
did:libreforge:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

**How it works:**
- Each user generates an Ed25519 keypair (same as SSH keys)
- The public key IS their identity (derived into a DID)
- Optional: link to Solana wallet for DAO participation
- The DID is portable — you can use it on ANY LibreForge instance
- Your contributions are signed with your key and are cryptographically verifiable regardless of which instance they live on

**Identity is not platform-dependent.** If forge-a.org shuts down, your identity persists. Your signed commits, issues, and reviews are verifiable on any other instance.

### 4. Trust Model

**Code Integrity:**
- All commits are signed (git's native GPG/SSH signing)
- LibreForge encourages (optionally enforces) commit signing
- Merge requests show signature verification status
- Release artifacts are signed and checksummed

**Identity Verification:**
- DID-based identity (cryptographic, self-sovereign)
- Optional: link to external identities (email, website, Solana wallet) with proof
- Web-of-trust: users can vouch for other users
- No KYC. No real name requirements. Pseudonymous by default, verifiable by choice.

**Instance Trust:**
- Instances in the federation can be rated/reviewed by the community
- Known-bad instances can be blocklisted (like email blocklists)
- Each instance controls its own federation policy (who to federate with)

**Contribution Verification:**
- Every contribution has a cryptographic signature
- Contributions can be independently verified by anyone
- Optional: hash contributions to Solana for immutable timestamping

### 5. Governance Model (DAO)

**Structure:**
```
┌─────────────────────────────────────────┐
│         LibreForge DAO (Solana)          │
│                                          │
│  Token: $FORGE (governance, non-tradeable│
│  soulbound; earned, not purchased)       │
│                                          │
│  Treasury: Multisig (5-of-9 council)     │
│                                          │
│  Proposals: On-chain, open to all        │
│  members with >100 $FORGE                │
│                                          │
│  Voting: Quadratic (√tokens = votes)     │
│  to prevent whale dominance              │
│                                          │
│  Council: 9 elected members, 1-year      │
│  terms, rotating thirds                  │
└─────────────────────────────────────────┘
```

**How $FORGE tokens are earned:**
- Code contributions (merged PRs): 10-100 $FORGE based on size/impact
- Issue triage and moderation: 5-20 $FORGE
- Documentation: 10-50 $FORGE
- Running a public seed/federation node: 1 $FORGE/day
- Financial donations: 1 $FORGE per $10 donated (capped at 1000/year to prevent plutocracy)
- Community contributions (translations, support): 5-20 $FORGE

**$FORGE is soulbound.** It cannot be bought, sold, or transferred. It represents contribution, not wealth. This prevents:
- Whale takeovers (you can't buy governance)
- Speculation (no financial incentive to hoard)
- Plutocracy (wealth ≠ influence)

**What the DAO decides:**
- Feature roadmap priorities
- Infrastructure spending
- Federation policy (which instances to trust/block)
- Protocol upgrades
- Council elections
- Emergency responses (security incidents, abuse)

**What the DAO does NOT decide:**
- Day-to-day maintainership (that's the maintainer team's job)
- Code quality standards (that's the review process)
- Individual instance policies (each instance is sovereign)

### 6. Funding Model

**Revenue sources:**
- Donations (individuals and organizations)
- Grants (NLnet, Sovereign Tech Fund, Open Technology Fund, EU grants)
- DAO treasury (managed by multisig)
- Optional paid support contracts (enterprise consulting, never feature-gating)
- Merchandise (yes, really — Linux, Blender, and Godot all generate meaningful merchandise revenue)

**What we will NEVER do:**
- Paid tiers with exclusive features
- Advertising
- Selling user data
- AI training on hosted code
- "Open core" (all features in one edition, always)

**Sustainability model:**
- Target: €5,000/month covers infrastructure for a large public instance (Codeberg operates on ~€1,050/month)
- 1,000 members donating €5/month = €5,000/month
- Grant funding for development (NLnet funds ForgeFed work; same model)
- Corporate sponsors can donate but get no governance power beyond their $FORGE cap

**Why this works:**
Codeberg proves the model. They run a forge serving 200,000+ users on €1,050/month with 2 part-time staff. The infrastructure cost of a git forge is not high. The expensive part is development, and that's where grants and volunteer contribution come in.

### 7. User Experience — Daily Workflow

**For a developer using LibreForge:**

```bash
# Clone a repo (standard git — no special tools needed)
$ git clone https://forge-a.org/alice/my-project.git

# Or clone from any instance in the federation
$ git clone https://forge-b.org/bob/cool-lib.git

# Work normally
$ git add .
$ git commit -m "fix: resolve race condition in auth handler"
$ git push

# Open a merge request (from CLI)
$ forge mr create --title "Fix auth race condition" --to bob@forge-b.org/cool-lib

# Or from the web UI — click "New Merge Request" just like GitHub

# Review: works just like GitHub/GitLab
# Comment on lines, approve, request changes

# CI: configure with .libreforge-ci.yml or .forgejo/workflows/
# (GitHub Actions-compatible format for easy migration)
```

**The key UX constraint:** A developer migrating from GitHub should feel at home within 5 minutes. If they need to read documentation to do basic operations, we've failed.

### 8. Migration Path (from GitHub)

**Automated migration tool: `forge migrate`**

```bash
# Migrate a single repo
$ forge migrate github --repo owner/repo-name --to https://my-instance.org

# Migrate an entire organization
$ forge migrate github --org my-org --to https://my-instance.org

# What gets migrated:
# ✅ All git history (obviously)
# ✅ Issues (with comments, labels, assignees, milestones)
# ✅ Pull requests (with review comments and status)
# ✅ Wiki content
# ✅ Releases (with assets)
# ✅ GitHub Actions → LibreForge CI (best-effort translation)
# ✅ README, LICENSE, CONTRIBUTING
# ❌ Stars (not portable — this is a GitHub social metric)
# ❌ GitHub Discussions (exported as markdown archive)
# ❌ GitHub-specific integrations (Copilot, Codespaces)
```

**Two-way mirror during transition:**
```bash
# Set up bidirectional mirroring during transition period
$ forge mirror --source github:owner/repo --target https://my-instance.org/owner/repo --bidirectional

# Pushes to either side are synced automatically
# Remove mirror when migration is complete
```

### 9. CI/CD Strategy

**LibreForge does NOT build a CI/CD system.** Instead:
- **Native support for Forgejo Actions** (GitHub Actions-compatible)
- **Webhook support** for external CI (Jenkins, Woodpecker, Drone, Buildkite)
- **Optional: Radicle CI bridge** for decentralized builds
- **Philosophy:** CI is a separate concern. Building it into the forge creates lock-in (GitHub Actions is the #1 lock-in mechanism). Instead, we support open standards and let users choose their CI.

---

# PART VII: WHAT WE DON'T BUILD

Equally important as what we build is what we refuse to build:

| Feature | Why We Don't Build It |
|---------|----------------------|
| **AI code assistant** | Training on hosted code is a betrayal of trust. If users want AI, they use their own tools with their own code. |
| **Social network features** | Stars, followers, contribution graphs are engagement metrics, not collaboration tools. They create lock-in, not value. |
| **Package registry** | Package hosting is a separate concern. Use existing decentralized registries or host your own. Building it in creates lock-in. |
| **Cloud dev environments** | (Codespaces-equivalent) This is vendor lock-in disguised as convenience. Use local development or self-hosted solutions. |
| **Built-in CI/CD execution** | CI lock-in is GitHub's most powerful retention mechanism. We provide CI hooks, not CI infrastructure. |
| **Analytics/telemetry** | We don't track users. Period. Instance admins can run their own analytics if they choose. |
| **"Enterprise Edition"** | One edition. All features. Always. If a feature is worth building, it's worth giving to everyone. |
| **Mobile app** | The web UI is responsive. A native app is maintenance burden for marginal benefit. If the community wants one, they can build it. |

---

## IMPLEMENTATION ROADMAP

### Phase 0: Foundation (Months 1-3)
- Fork Forgejo as starting point (don't reinvent the wheel)
- Implement DID-based identity system
- Implement flat-file export (`libreforge export`)
- Set up public test instance
- Write migration tool (GitHub → LibreForge)
- Establish DAO on Solana devnet

### Phase 1: Federation (Months 3-6)
- Implement ForgeFed protocol (building on Forgejo's existing work)
- Cross-instance merge requests
- Cross-instance identity resolution
- Test with 3+ federated instances
- Launch public beta

### Phase 2: Governance (Months 6-9)
- Deploy $FORGE token on Solana mainnet
- Implement contribution tracking → token minting
- Launch DAO governance (proposals, voting)
- Elect first council
- Apply for NLnet / Sovereign Tech Fund grants

### Phase 3: Polish (Months 9-12)
- UX refinement (close the gap with GitHub)
- Performance optimization
- Security audit (independent)
- Documentation
- Community building

### Phase 4: Growth (Year 2+)
- Federation network expansion
- Radicle bridge for p2p fallback
- Federated search across instances
- Mobile-responsive UI improvements
- Localization (i18n)

---

## FINAL ASSESSMENT

### Why Existing Alternatives Haven't Won

| Alternative | Why It Hasn't Replaced GitHub |
|-------------|-------------------------------|
| **GitLab** | Open-core model means best features cost money. Public company pressure. |
| **Codeberg** | Scale concerns. Single instance. No federation (yet — Forgejo is building it). |
| **SourceHut** | Email-based workflow alienates 95% of developers. One-person-identified. |
| **Radicle** | UX is years behind GitHub. No web-based collaboration. Tiny community. |
| **Fossil** | Not Git-compatible. Philosophical opposition to how most developers work. |

### Why LibreForge Can Win

1. **We don't start from scratch.** Forgejo is already 90% of the forge we need. We add identity, federation, governance, and migration.

2. **We don't fight Git.** Every failed alternative tried to replace Git. We embrace it. Standard git commands work unchanged.

3. **We don't fight developers' habits.** The UI looks and works like GitHub. Pull requests, not email patches. Web-based code review, not mailing lists.

4. **Federation breaks the network effect.** You don't need everyone on one instance. You need instances that talk to each other. LibreForge instances + Forgejo instances + (eventually) GitLab instances, all speaking ForgeFed, collectively rival GitHub's network.

5. **The DAO prevents capture.** No single person, company, or government can acquire, shut down, or redirect LibreForge. The governance is on-chain, transparent, and accountable.

6. **The timing is right.** Zig, Gentoo, Dillo, and the Software Freedom Conservancy are already leaving GitHub. The migration has begun. We need to be ready when the wave crests.

### The Honest Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Network effect too strong** | 🔴 HIGH | Federation reduces the threshold — you don't need to beat GitHub, you need to connect enough instances |
| **Funding unsustainable** | 🟡 MEDIUM | Codeberg proves the model at €1K/month. Grants fund development. |
| **UX never catches up** | 🟡 MEDIUM | Start from Forgejo (already good). Focus UX budget on the gap areas. |
| **Federation too complex** | 🟡 MEDIUM | Forgejo is already implementing ForgeFed. We build on their work, not from scratch. |
| **DAO governance dysfunction** | 🟡 MEDIUM | Quadratic voting + soulbound tokens prevent whale capture. Council provides day-to-day stability. |
| **Nobody comes** | 🔴 HIGH | If the GitHub exodus accelerates (Copilot backlash, further AI overreach), they need somewhere to go. Be ready. |

---

## CONCLUSION

The history of version control and repository hosting is a history of trust built and betrayed. Every platform that gained dominance eventually abused that dominance — or was acquired by someone who did.

The pattern is clear:
- **SCCS → CVS → SVN → Git:** Each generation fixed the previous generation's technical failures.
- **SourceForge → Google Code → GitHub:** Each generation fixed the previous generation's hosting failures.

But the governance failure has never been fixed. SourceForge was a private company that bundled adware. Google Code was a Google side project that got killed. GitHub is a Microsoft subsidiary that trains AI on your code.

**LibreForge is the attempt to fix the governance failure.** Not just a better forge — a forge that *structurally cannot betray you*, because:
- The code is AGPL (you can always fork and run your own)
- The governance is a DAO (no single entity can capture it)
- The protocol is federated (no single instance is critical)
- The identity is yours (not the platform's)
- The data is exportable (you can leave at any time)

Whether LibreForge succeeds depends on execution, timing, and community. But the design is sound, the need is real, and the precedent (Codeberg, Forgejo, Radicle) proves the model works.

The forge of the future will be free, federated, and sovereign. The only question is whether we build it now or wait for the next betrayal to force the issue.

---

**— Linus**

*"Talk is cheap. Show me the code."*
*— Linus Torvalds*

*This document is dedicated to the public domain under CC0. Copy, share, build on it. That's the point.*
