# Center automatic reporting

Super admins configure automatic reporting in Centers > center profile. Each center has independent switches for X-Ray, Special X-Ray, CT, MRI, Mammography, PET-CT and USG.

A complete new upload matching an enabled modality receives a persisted deadline five minutes in the future. Staff can save clinical indication, history and supporting files during this period. The server checks due studies every five seconds and submits them through the existing reporting pipeline. Reporting TAT starts at submission, excluding the grace period. Manual submission is still available and cancels the countdown.

Turning a modality off cancels pending deadlines for that modality. Enabling applies to new uploads, not the existing manual backlog. Routine X-Ray is enabled by default to preserve the previous automatic routing; all other modalities default off. Blocked centers and studies without a configured service are not submitted.

Deploy the Prisma migration 20260930120000_center_auto_reporting before starting the updated API. Rebuild the Prisma client and application as usual. The worker resumes persisted deadlines on restart. Browser closure does not affect dispatch.

Validation: TypeScript, production build, and automated modality/countdown/response tests. Live provider submission and a database-backed concurrent dispatch exercise require a configured integration environment.
