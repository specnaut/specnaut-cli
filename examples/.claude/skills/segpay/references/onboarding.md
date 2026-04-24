# SegPay — Merchant Onboarding Guide

> **Load this when:** Kevin asks how to apply to SegPay, how to get a merchant
> account, what documents are needed, or what to expect during the approval
> process.

## TL;DR

SegPay is a **high-risk-friendly** payment processor. Applying is **not
self-service** — you go through a Sales Representative who guides you through
the application, KYC, underwriting, and merchant account setup. Expect the
process to take **1 to 4 weeks**, sometimes longer for high-risk categories.

## Step 1 — Initial Contact

Start here:

- **Official contact page**: https://segpay.com/contact-us/
- **General inquiries**: fill the contact form
- **Direct sales email**: typically `sales@segpay.com` (confirm on the contact
  page at time of application)
- **Phone**: listed on the contact page for US and international
- **LinkedIn**: SegPay has active sales reps reachable via LinkedIn — useful for
  faster response

### What to say in your first message

A clear, business-like introduction dramatically speeds up the process.
Template:

> Subject: Merchant application — Miximodel (creative/model platform)
>
> Hello,
>
> I'm Kevin Raimbaud, founder of Miximodel, a subscription platform for models,
> artists, and creative professionals. Lemon Squeezy recently declined our
> application as "high risk", and SegPay was recommended as a better fit for our
> segment.
>
> Our profile:
>
> - Business type: SaaS subscription (monthly + yearly Pro plans)
> - Content: creative/fashion profiles, portfolios, notices (potentially NSFW in
>   some user content, but not adult-only)
> - Current stage: pre-launch / early revenue; URL: https://miximodel.com
> - Target volume: [your realistic first-year estimate]
> - Company: [legal entity name, country]
>
> Could you point me to the right sales representative to start a merchant
> application? Happy to share any additional info needed.
>
> Thanks, Kevin

## Step 2 — Documents to Prepare (before the sales call)

Gather these **before** the first sales conversation. Having them ready moves
the process from weeks to days.

### Corporate documents

- [ ] **Certificate of incorporation** / statuts (for an SAS/SARL in France, a
      Kbis extract < 3 months old)
- [ ] **Proof of registered business address** (utility bill, lease, or bank
      statement)
- [ ] **Tax/VAT identification number**
- [ ] **Articles of association** (statuts)
- [ ] **UBO declaration** (ultimate beneficial owners — if corporate, list
      owners with ≥25% stake)

### Personal documents (for the signatory / director)

- [ ] **Passport or national ID** (color scan, both sides)
- [ ] **Proof of address** (utility bill < 3 months old)
- [ ] **Personal tax ID** (if different from company)

### Banking

- [ ] **Bank account details** for settlements (IBAN, BIC, bank name, account
      holder name matching the company legal name)
- [ ] **Bank statement** (recent, showing the company as account holder)
- [ ] **Letter from bank** confirming account (some underwriters ask for this)

### Business documentation

- [ ] **Business plan** or deck (1-2 pages is fine; explains what Miximodel is,
      target audience, revenue model)
- [ ] **Expected transaction volume** (monthly / yearly, average ticket size)
- [ ] **Chargeback history** (if any previous processor — if Lemon Squeezy
      declined before launch, there is none, which is actually good)
- [ ] **Processing history** (if any; likely none)

### Website / platform requirements

SegPay will **review the website** before approving. Before applying, ensure
miximodel.com has all of the following **visible and complete**:

- [ ] **Terms of Service** — clear subscription terms, billing, auto-renewal
- [ ] **Privacy Policy** — GDPR-compliant (EU) + data processing
- [ ] **Refund Policy** — mandatory; must state the refund window (14 days EU
      legal minimum) and process
- [ ] **Cancellation Policy** — how users can cancel; must be easy and
      documented
- [ ] **Contact page** — physical address, support email, phone (or at least a
      contact form)
- [ ] **About page** — company legal name visible
- [ ] **Clear description of what users pay for** (Pro plan features list,
      pricing page)
- [ ] **Age verification** — if any content is adult-adjacent, an age gate is
      **mandatory** for high-risk processors
- [ ] **Customer support** — visible support email / chat
- [ ] **Cookie consent** — GDPR
- [ ] **DBA / Descriptor plan** — the short name that will appear on consumer
      bank statements (e.g. "MIXIMODEL.COM"). SegPay will ask what descriptor
      you want.

## Step 3 — Questions YOU Should Ask During the Sales Call

Use this as your checklist when you get the first call. The answers directly
feed into the Miximodel implementation.

### Commercial

1. What is your **discount rate** (% per transaction) for our profile?
2. What are the **transaction fees** (fixed + percentage)?
3. What are the **chargeback fees** (per incident)?
4. What are the **fees for CDA / Dispute Alerts** and **RDR**?
5. Is there a **monthly minimum** or **setup fee**?
6. What is the **reserve requirement** (rolling reserve %, hold period)?
7. What is the **settlement schedule** and **delay** (documented as 3 days in
   arrears, no Sundays/Mondays — confirm for our account)?
8. What **currency** will we be settled in (EUR preferred for us)?

### Tax / compliance

9. Does SegPay act as **merchant of record** (MoR) or as a pure **payment
   processor**?
10. Does SegPay **collect VAT** automatically based on the consumer's country?
11. If not, do you provide **tax reports** usable for MOSS / OSS filing in the
    EU?
12. How is **SCA / 3-D Secure** handled?
13. What is your **PCI compliance** responsibility model for us?

### Technical

14. What is the **Signup URL** base for sandbox and production?
15. How do we **verify postback authenticity** — HMAC signature, IP allowlist,
    shared secret, or HTTP Basic Auth?
16. What is your **egress IP range** for postbacks (for allowlisting at our
    edge)?
17. Where can we access the **SRS WSDL** files and the technical documentation
    for the SOAP operations?
18. Do you have a **sandbox environment** with distinct credentials from
    production? How do we request access?
19. Do you provide **test card numbers beyond the two documented**
    (`4444 3333 2222 1111` / `4444 4444 4444 4455`)?
20. What is the expected **integration timeline** from credentials to go-live?

### Operational

21. What is the **consumer support** escalation path (24×7 claimed — confirm
    channels and languages)?
22. What **chargeback ratio thresholds** apply to our account before CDA becomes
    mandatory?
23. Are there **content restrictions** beyond the standard OFAC / illegal
    categories? Specifically, what is SegPay's policy on **user-generated NSFW
    content** (photos uploaded by users on profiles)?
24. Can we **change DBA descriptors** later, or is it fixed at underwriting?
25. What happens if we **exceed volume projections** — is there a velocity cap
    we need to request to lift?

## Step 4 — What to Expect During Underwriting

1. **Initial sales conversation** (30-60 min) — explain the business, confirm
   SegPay can process for your category.
2. **Application form** — detailed corporate + personal info, plus website
   review.
3. **KYC review** — SegPay's compliance team verifies identities, corporate
   documents, and UBO.
4. **Underwriting** — risk assessment based on business type, processing
   history, volume, and website review. Expect requests for additional documents
   or website changes.
5. **Approval & account setup** — once approved, SegPay provisions:
   - Merchant Portal login
   - Merchant ID
   - SRS User ID + Access Key
   - Sandbox access (usually)
   - A specific onboarding contact for technical integration
6. **Integration phase** — you build and test against sandbox.
7. **Go-live review** — SegPay may want a final review of the live site before
   switching packages to Live Mode.
8. **First settlement** — 3 days after first successful transaction (excluding
   Sundays/Mondays).

**Typical total duration**: 1-4 weeks for standard profiles, longer if documents
are incomplete or if underwriting requests changes.

## Step 5 — While Waiting for Approval

**Parallel work** you can do without SegPay credentials:

- Start the Phase A implementation of spec 177 (see
  `specs/177-segpay-integration/spec.md`)
- Build the `SegPayDriver` skeleton with mocked HTTP
- Remove all Lemon Squeezy code and dependencies
- Rename the `plans` columns to provider-agnostic names
- Normalize `WebhookService` around `NormalizedWebhookEvent`
- Write unit tests with synthetic fixtures
- Draft the `docs/payment-processors.md` playbook
- Harden the pricing page and billing settings UX
- Write the Terms of Service, Refund Policy, Cancellation Policy
- Add an age gate to the website if user content is NSFW-adjacent (required for
  approval)
- Set up a dedicated `support@miximodel.com` mailbox with auto-ack

**Do not skip the legal pages** — they are the most common cause of underwriting
rejections. SegPay compliance will literally read them.

## Step 6 — Red Flags to Avoid

Avoid any of these in your first conversation or application:

- **Vague business description** — "we're a marketplace" is not enough. Be
  specific.
- **Understating content risk** — if user profiles may contain mature content,
  say so upfront. Being caught later is fatal.
- **Mismatched company info** — the name on the bank statement, the Kbis, and
  the website must all match.
- **Unrealistic volume projections** — underwriters discount inflated numbers
  and may set velocity caps below your ask.
- **Missing legal pages on the site** — instant delay.
- **Using a personal bank account** — settlement must go to a business account
  matching the legal entity.
- **Requesting rates before providing documents** — SegPay quotes rates based on
  risk assessment, which requires KYC first.

## Step 7 — After Approval — First Actions

Once you have SegPay credentials:

1. **Store secrets in Pulumi** (GCP Secret Manager) and sync to Cloud Build per
   the project's infra separation rule.
2. **Configure the first package** in the Merchant Portal (monthly Pro plan, EUR
   base, DMC enabled).
3. **Set up the postback URL** pointing to the Miximodel tunnel or preview
   deploy.
4. **Run the first sandbox checkout** end-to-end.
5. **Update the plan seeder** with real package IDs.
6. **Document the credentials and portal layout** in this skill — add
   screenshots if helpful.

## How the segpay-specialist Agent Can Help

The agent can help Kevin with:

- **Drafting the first email** to SegPay sales with a tailored introduction
  based on Miximodel's current state
- **Reviewing miximodel.com** against the compliance checklist above and
  producing a punch-list of missing items
- **Drafting ToS / Privacy / Refund / Cancellation pages** in a form SegPay
  compliance will accept (reviewed by a lawyer before publishing)
- **Preparing a short business plan / deck** (1-2 pages) for underwriting
- **Building a checklist of questions** tailored to the specific SegPay rep's
  answers as they come in
- **Reading and summarizing any SegPay documentation** sent during underwriting

Ask the agent: _"Help me prepare for SegPay onboarding"_ and it will walk
through the checklist above.
