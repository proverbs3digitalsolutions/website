# BalayHub — Philippine Data Privacy Readiness (RA 10173)

Status of each item from the specification. ✅ = implemented in the product; 🟡 = partly done or a draft; ⬜ = an organizational task still to do before launch.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Privacy policy & notice | 🟡 | Draft notice at `#/privacy` (public/js/views/privacy.js). Needs legal review and real DPO contact details |
| 2 | Lawful basis per processing activity | 🟡 | Draft mapping in the notice (contract for accounts; landlord's legitimate interest or contract for tenant records). Needs confirmation by counsel |
| 3 | Clear consent where required | ✅ / 🟡 | Privacy Notice acknowledgement is required at sign-up and stored in `consent_records` with the policy version. No consent-based processing (marketing, analytics) exists yet; add specific opt-ins if that changes |
| 4 | Data minimization | ✅ | Tenant fields limited to name, email, phone, emergency contact and notes. No government ID fields. The UI warns against recording sensitive details |
| 5 | Access controls & encryption | ✅ / ⬜ | Server-enforced org and property scoping, roles, hashed passwords, secure cookies, private files. **To do:** enable TLS at the host, and encryption at rest on the database and volume (a managed-provider setting) |
| 6 | Data-subject rights | 🟡 | Owners can export a tenant's full record (JSON) and correct or archive it. **To do:** a written procedure for deletion and blocking requests, including legally required retention |
| 7 | Retention & disposal | ⬜ | Define retention periods (for example, financial records kept for the BIR-required period) and a disposal job for closed workspaces and backups |
| 8 | Incident response | 🟡 | Audit log and error logs exist. **To do:** monitoring and alerting, a breach-assessment procedure, and the NPC 72-hour notification playbook |
| 9 | Vendor / processor agreements | ⬜ | Review DPAs for hosting, database, email (SMTP) and storage providers |
| 10 | Privacy accountability | ⬜ | Appoint a DPO and assess whether NPC registration applies |

**Before launch, a qualified Philippine privacy professional must review the actual data flows.**
