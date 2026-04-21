---
tags: [design, microsoft-365, mcp, future]
created: 2026-04-21
updated: 2026-04-21
sources:
  - https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/workiq-overview
  - https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview
---

# Work IQ MCP

Work IQ MCP is Microsoft's MCP/tool layer for connecting agents to Microsoft
365 work context.

It can expose organization context such as:
- Outlook email
- calendar and meetings
- Teams messages
- SharePoint and OneDrive files
- people/org profile information
- Word documents
- Dataverse/Dynamics data, depending on enabled tools

The Work IQ CLI can run as an MCP server:

```bash
npx -y @microsoft/workiq mcp
```

## Why It May Matter For Aura

Work IQ could become useful for later phases where aura needs Microsoft 365
context rather than simple webhook-style integration.

Potential uses:
- Read Teams discussions around a failed test.
- Read SharePoint/OneDrive test plans or Excel files used as change sources.
- Find requirement docs related to a test or failure.
- Use Work IQ Teams tools for richer Teams interactions than the current
  one-way Teams webhook notification.
- Support P10 change intake by reading Microsoft 365-hosted change lists.

## Caveats

- Work IQ is currently a preview feature.
- It requires a Microsoft 365 Copilot license.
- It may require Microsoft Entra tenant/admin consent.
- It is enterprise-governed through Microsoft 365/Agent 365 controls.
- For current aura demo needs, the simple Teams Workflows webhook is lower
  risk and easier to configure.

## Current Decision

Do not integrate Work IQ MCP yet.

Keep it as a future option for:
- P10 change intake and autonomous test planning
- richer Microsoft 365 context lookup
- future Teams/SharePoint/Excel integrations
