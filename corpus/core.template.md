---
# A record in the front-matter shape of the SciOS core-and-satellite model, filled in for Typed
# Standards from public sources. Field names are those the model's published examples show;
# everything else is under x-typedstandards. NOT DONE marks a core responsibility this project
# does not hold.
# type: core       NOT DECLARED. The self-assessment below is "satellite"; see x-typedstandards.
name: Typed Standards
id: typedstandards.org
createdAt: {{createdAt}}
domain: analysis-provenance              # horizontal: spans the fields whose analyses it records
mission: Make how an analytical artifact was produced checkable by anyone, offline, without trusting its publisher.
description: A specification for signed records of how analytical artifacts were produced, including AI-assisted analyses of public data, with a reference producer, a reference verifier and a reference publishing application.
resource: https://typedstandards.org
lifecycleStatus: active
tags: [provenance, signed-records, ai-assisted-analysis, open-data, horizontal]

# funding: {}      NOT DONE. No fiscal host, no public ledger, no allocation rule; nothing is routed to other projects.
# agent: {}        NOT EXPOSED for this domain. The project's MCP server serves civic open data, not this domain's map; no vetted skills or eval suites for the domain.
# certifies: []    NOT DONE. No model, agent or tool is certified; no norms for AI-generated contributions.

x-typedstandards:
  selfAssessment: satellite
  selfAssessmentBasis:
    - One maintainer. The project's roadmap says "The project is maintained by one person" (hub-roadmap, section 2).
    - The model describes a core as a body of people, "a community of humans, not a collaboration of artifacts", and reads one repository surfacing a record as, in spirit, a satellite.
    - Typed Standards is a specification, and the model says a core is not a standards body.
    - No core record exists in this domain, so the map beside this record carries no orbits edge.
  typeDeclared: false
  specification:
    version: v0.1.9
    licence: CC BY 4.0
    ref: {{ref:ts-spec}}
  artifacts:
    - name: "@typedstandards/verify-core"
      kind: library
      version: "0.10.0"
      ref: {{ref:verify-core-npm}}
    - name: "@typedstandards/produce-core"
      kind: library
      version: "0.5.0"
      ref: {{ref:produce-core-npm}}
    - name: typedstandards.org
      kind: site and client-side verifier
      ref: {{ref:typedstandards-repo}}
    - name: civicaitools.org
      kind: reference publishing application
      ref: {{ref:civicaitools-website}}
    - name: socrata-mcp-server
      kind: MCP server for civic open data
      ref: {{ref:socrata-mcp-server}}
    - name: typedstandards-eval-run-example
      kind: worked example
      ref: {{ref:eval-run-example}}
  governance:
    decisionRecords: '29 public ADRs in the hub repository at the pinned commit, each stating "Decision-maker: Solo maintainer"'
    decisionRecordsCited:
      - {{ref:hub-adr-0029}}
      - {{ref:hub-adr-0030}}
    roadmap: {{ref:hub-roadmap}}
    licensing: {{ref:hub-licensing}}
  satelliteLifecycle: none
  map: map.yaml
---

# What this record is

A record in the front-matter shape that the SciOS paper "The Core-Satellite Model" (scios.tech/thoughts,
dated 2026-06-30) uses for its worked examples, filled in for Typed Standards and the Civic AI Tools
repositories that implement it. Every fact comes from a public source listed at the end, pinned by
SHA-256. The paper's schema v0.1 is not published (scios.tech/thoughts, read 2026-09-22), so this record
uses only the field names its examples show, and puts everything else under `x-typedstandards`.

# Self-assessment: a satellite

In the model's terms this project is a satellite, not a core and not an emerging core. It is one
maintainer's specification and the libraries, site and application that implement it. The model reads
a core as a body of people who hold a domain's judgment together, and it names a standards body as one of
the things a core is not.

The record inverts the paper's AstroPy example. AstroPy has the people half of a core (a committee,
voting members, a finance body, a proposal process) and lacks the agent half. This project has parts of
the agent half (signed records, an offline verifier an agent can call, an MCP server) and none of the
people half.

The record omits `type: core`. The model treats surfacing a core record as declaring oneself a core, and
this record's self-assessment says the project is not one.

# Core responsibilities

| Core responsibility (the model's list) | What this project does | Verdict |
|---|---|---|
| Hold an opinionated judgment on the domain: canonical, dependency, trusted, experimental, dead | `map.yaml` states technical relations to public projects. It marks nothing canonical, trusted or dead, and it is one maintainer's reading. | NOT DONE |
| Maintain stabilized, canonical versions of the domain's artifacts | The specification (v0.1.9, CC BY 4.0) and its reference packages, versioned independently. They are this project's own artifacts; no other party has declared them canonical. | Partial |
| Manage in-flow and distribution of funding | None. | NOT DONE |
| Build and maintain an agentic toolchain for the domain | An offline verifier library and a producer library that an agent can call, and an MCP server and a publishing skill for civic open data. No MCP endpoint serves this domain's map, and there is no eval suite. | Partial |
| Certify or attest to AI behavior in the domain | The specification's `attestation/certifies/v1` and `attestation/evaluates/v1` sub-types are ratified and recognized by check #12. No check enforces their authorization rules or payloads (specification §8.12.4), and nothing is certified. | NOT DONE |
| Act as a partner channel for AI labs | None. | NOT DONE |
| Set internal protocols for governance, finance and satellite lifecycle | A public roadmap and public decision records, each decided by the solo maintainer. No finance protocol, and no insertion, orbit, accretion, ejection or sunsetting protocol. | Partial |
| The people: maintainers, governance, sustainability and domain roles | One maintainer. | NOT DONE |

# Sources

Each source was fetched once by `corpus/pin.mjs` and is pinned in `corpus/manifest.json`.

{{sources:core}}
