---
# A record in the front-matter shape of the SciOS core-and-satellite model, filled in for Typed
# Standards from public sources. Field names are those the model's published examples show;
# everything else is under x-typedstandards. NOT DONE marks a core responsibility this project
# does not hold.
# type: core       NOT DECLARED. The self-assessment below is "satellite"; see x-typedstandards.
name: Typed Standards
id: typedstandards.org
createdAt: 2026-09-22
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
    ref: { location: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/docs/architecture/typed-standards-specification.md, sha256: 0e3b54b39e6877a076c495b82afd7295aefac09c70054c02e9832147037ff3f5 }
  artifacts:
    - name: "@typedstandards/verify-core"
      kind: library
      version: "0.10.0"
      ref: { location: https://registry.npmjs.org/@typedstandards/verify-core/-/verify-core-0.10.0.tgz, sha256: cb37b7491a5e150c80e3075a35c7e0a23accfa15633604c03ba2d235962e1738 }
    - name: "@typedstandards/produce-core"
      kind: library
      version: "0.5.0"
      ref: { location: https://registry.npmjs.org/@typedstandards/produce-core/-/produce-core-0.5.0.tgz, sha256: 77f9414ee03f3054f09fff83786b4cabd41871acb9b137e506b5dcf6a207c143 }
    - name: typedstandards.org
      kind: site and client-side verifier
      ref: { location: https://raw.githubusercontent.com/npstorey/typedstandards/b0bf0a447ba35991ca2a211fa71983e1ba9ac78e/README.md, sha256: c0a1894c4089a615d685b420d632f50b9edfadd963a58fda9c7b9e025a086f9c }
    - name: civicaitools.org
      kind: reference publishing application
      ref: { location: https://raw.githubusercontent.com/npstorey/civic-ai-tools-website/109eecb809a53bd36cc3468c79d243457570a49d/README.md, sha256: ba16dd52cf07fe369bf6359d22bfe36bae345614179fd14d5e814ac481cde89f }
    - name: socrata-mcp-server
      kind: MCP server for civic open data
      ref: { location: https://raw.githubusercontent.com/npstorey/socrata-mcp-server/5b18c979b37465999d686785074973a340207555/README.md, sha256: 7e4a5242bf2d8f2439ef0963b9afb823fbfced25bcc7bad59375c5dca618ae02 }
    - name: typedstandards-eval-run-example
      kind: worked example
      ref: { location: https://raw.githubusercontent.com/npstorey/typedstandards-eval-run-example/9031a94eebe0d800e52eab6fd4e01c7e788603a6/README.md, sha256: 3e405213b53a67e9ebffa7e1f332b34ddbbd3c894d6b1c556c8ca25109930529 }
  governance:
    decisionRecords: '29 public ADRs in the hub repository at the pinned commit, each stating "Decision-maker: Solo maintainer"'
    decisionRecordsCited:
      - { location: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/docs/adr/0029-scripted-recomputation-producer-profile.md, sha256: 77bac194751209d897438b5e8f7b716fe84804ba3388d0c7a61ff790810697f5 }
      - { location: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/docs/adr/0030-self-certifying-signer-did-key.md, sha256: 0e237cd72737e4e3ab115e0a2515be8d9d3d1f4440f75323b5983433468fde55 }
    roadmap: { location: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/ROADMAP.md, sha256: 691cce2f7419e3e0514654ecbd17538c56fdd2bc55eb9f30225a2130d48795d6 }
    licensing: { location: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/LICENSING.md, sha256: bba91fe755ada927433253be351d3b6475e39a03adbce568da2303e26c379c19 }
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

- `ts-spec`: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/docs/architecture/typed-standards-specification.md
  sha256 `0e3b54b39e6877a076c495b82afd7295aefac09c70054c02e9832147037ff3f5`, 294146 bytes, HTTP 200, fetched 2026-09-22T19:20:25Z; licence: CC BY 4.0, as the document states (§3)
- `hub-roadmap`: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/ROADMAP.md
  sha256 `691cce2f7419e3e0514654ecbd17538c56fdd2bc55eb9f30225a2130d48795d6`, 36097 bytes, HTTP 200, fetched 2026-09-22T19:20:25Z; licence: MIT (repository LICENSE)
- `hub-licensing`: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/LICENSING.md
  sha256 `bba91fe755ada927433253be351d3b6475e39a03adbce568da2303e26c379c19`, 5160 bytes, HTTP 200, fetched 2026-09-22T19:20:25Z; licence: MIT (repository LICENSE)
- `hub-adr-0029`: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/docs/adr/0029-scripted-recomputation-producer-profile.md
  sha256 `77bac194751209d897438b5e8f7b716fe84804ba3388d0c7a61ff790810697f5`, 26099 bytes, HTTP 200, fetched 2026-09-22T19:20:25Z; licence: MIT (repository LICENSE)
- `hub-adr-0030`: https://raw.githubusercontent.com/npstorey/civic-ai-tools/cfdb210cdae865a872ff30f7c86c5fdcd74e9886/docs/adr/0030-self-certifying-signer-did-key.md
  sha256 `0e237cd72737e4e3ab115e0a2515be8d9d3d1f4440f75323b5983433468fde55`, 35063 bytes, HTTP 200, fetched 2026-09-22T19:20:25Z; licence: MIT (repository LICENSE)
- `typedstandards-repo`: https://raw.githubusercontent.com/npstorey/typedstandards/b0bf0a447ba35991ca2a211fa71983e1ba9ac78e/README.md
  sha256 `c0a1894c4089a615d685b420d632f50b9edfadd963a58fda9c7b9e025a086f9c`, 7358 bytes, HTTP 200, fetched 2026-09-22T19:20:25Z; licence: MIT (repository LICENSE)
- `verify-core-npm`: https://registry.npmjs.org/@typedstandards/verify-core/-/verify-core-0.10.0.tgz
  sha256 `cb37b7491a5e150c80e3075a35c7e0a23accfa15633604c03ba2d235962e1738`, 65418 bytes, HTTP 200, fetched 2026-09-22T19:20:25Z; licence: MIT (package.json license field)
- `produce-core-npm`: https://registry.npmjs.org/@typedstandards/produce-core/-/produce-core-0.5.0.tgz
  sha256 `77f9414ee03f3054f09fff83786b4cabd41871acb9b137e506b5dcf6a207c143`, 30853 bytes, HTTP 200, fetched 2026-09-22T19:20:26Z; licence: MIT (package.json license field)
- `civicaitools-website`: https://raw.githubusercontent.com/npstorey/civic-ai-tools-website/109eecb809a53bd36cc3468c79d243457570a49d/README.md
  sha256 `ba16dd52cf07fe369bf6359d22bfe36bae345614179fd14d5e814ac481cde89f`, 9092 bytes, HTTP 200, fetched 2026-09-22T19:20:26Z; licence: MIT (repository LICENSE)
- `socrata-mcp-server`: https://raw.githubusercontent.com/npstorey/socrata-mcp-server/5b18c979b37465999d686785074973a340207555/README.md
  sha256 `7e4a5242bf2d8f2439ef0963b9afb823fbfced25bcc7bad59375c5dca618ae02`, 7975 bytes, HTTP 200, fetched 2026-09-22T19:20:26Z; licence: MIT (repository LICENSE, two copyright lines)
- `eval-run-example`: https://raw.githubusercontent.com/npstorey/typedstandards-eval-run-example/9031a94eebe0d800e52eab6fd4e01c7e788603a6/README.md
  sha256 `3e405213b53a67e9ebffa7e1f332b34ddbbd3c894d6b1c556c8ca25109930529`, 9271 bytes, HTTP 200, fetched 2026-09-22T19:20:27Z; licence: MIT for code, CC BY 4.0 for text (README)
