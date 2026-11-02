import type { Options } from 'roughjs/bin/core';
import type { ComponentType } from '../../core/schema.ts';
import { type Spec, gen, roundRect, line, glyph, tiled, cloud, arrow } from './base.ts';

const bold = (o: Options) => ({ ...line(o), strokeWidth: 2.4 });
const shield = (o: Options, c: number) => gen.path(`M${c} 3 L${c + 28} 13 V34 Q${c + 28} 54 ${c} 66 Q${c - 28} 54 ${c - 28} 34 V13 Z`, o);
const check = (o: Options, x: number, y: number) => gen.linearPath([[x - 12, y], [x - 3, y + 10], [x + 13, y - 11]], bold(o));
const page = (o: Options, c: number) => gen.polygon([[c - 22, 4], [c + 10, 4], [c + 22, 16], [c + 22, 62], [c - 22, 62]], o);
const person = (o: Options, c: number) => [gen.circle(c, 16, 22, o), gen.path(`M${c - 22} 62 Q${c - 22} 32 ${c} 32 Q${c + 22} 32 ${c + 22} 62 Z`, o)];

const maskedEye = (o: Options, x: number, y: number) => [...glyph.eye(o, x, y), gen.line(x - 12, y + 11, x + 12, y - 11, line(o))];
const envelope = (o: Options, x: number, y: number) => [gen.rectangle(x - 13, y - 9, 26, 18, line(o)), gen.linearPath([[x - 13, y - 9], [x, y + 2], [x + 13, y - 9]], line(o))];

/** Parts of a threat model and of the security programme around it. Shared defences come from the system kit (see `kits` on those parts). */
export const security = {
  // Security: threat model
  'threat-actor': {
    name: 'Threat actor',
    group: 'threat',
    keywords: 'attacker adversary hacker malicious insider intruder cybercriminal nation state ransomware gang',
    w: 100,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.path(`M${c - 26} 64 Q${c - 28} 40 ${c - 16} 30 Q${c - 20} 4 ${c} 4 Q${c + 20} 4 ${c + 16} 30 Q${c + 28} 40 ${c + 26} 64 Z`, o),
        gen.ellipse(c, 24, 20, 24, l),
        gen.line(c - 6, 22, c - 2, 24, l),
        gen.line(c + 6, 22, c + 2, 24, l),
      ];
    },
  },
  threat: {
    name: 'Threat',
    group: 'threat',
    keywords: 'attack stride spoofing tampering repudiation disclosure elevation abuse linddun pasta mitre att&ck technique',
    w: 110,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.polygon([[c, 4], [c + 36, 62], [c - 36, 62]], o), gen.line(c, 24, c, 44, bold(o)), gen.circle(c, 53, 3, line(o))];
    },
  },
  vulnerability: {
    name: 'Vulnerability',
    group: 'threat',
    keywords: 'weakness cve cwe owasp flaw exposure misconfiguration cvss injection xss',
    w: 100,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2;
      return [shield(o, c), gen.linearPath([[c + 3, 3], [c - 6, 20], [c + 5, 30], [c - 5, 44], [c + 2, 66]], line(o))];
    },
  },
  exploit: {
    name: 'Exploit',
    group: 'threat',
    keywords: 'exploit payload proof of concept poc metasploit zero-day weaponized shellcode',
    w: 90,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.polygon([[c + 6, 4], [c - 16, 36], [c - 2, 36], [c - 8, 62], [c + 16, 26], [c + 2, 26]], o)];
    },
  },
  'attack-step': {
    name: 'Attack step',
    group: 'threat',
    keywords: 'attack tree kill chain lateral movement initial foothold persistence exfiltration pivot',
    w: 120,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.line(c, 24, c - 26, 42, l), gen.line(c, 24, c + 26, 42, l), gen.rectangle(c - 22, 4, 44, 20, o), gen.rectangle(c - 42, 42, 32, 18, o), gen.rectangle(c + 10, 42, 32, 18, o)];
    },
  },
  'entry-point': {
    name: 'Entry point',
    group: 'threat',
    keywords: 'entry point attack surface ingress trust crossing exposed public endpoint phishing lure',
    w: 110,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 14, 4, 42, 58, o), gen.circle(c + 18, 34, 5, l), ...arrow(l, c - 44, c - 2, 34)];
    },
  },
  asset: {
    name: 'Asset',
    group: 'threat',
    keywords: 'crown jewels sensitive pii phi pci confidential protected valuable intellectual property',
    w: 110,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.polygon([[c - 22, 6], [c + 22, 6], [c + 38, 24], [c, 62], [c - 38, 24]], o), gen.line(c - 38, 24, c + 38, 24, l), gen.linearPath([[c - 22, 6], [c - 12, 24], [c, 62], [c + 12, 24], [c + 22, 6]], l)];
    },
  },
  risk: {
    name: 'Risk',
    group: 'threat',
    keywords: 'risk register heat map likelihood impact severity residual appetite dread fair',
    w: 100,
    h: 80,
    labelY: 70,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 27, 4, 54, 54, o), ...[1, 2].flatMap((i) => [gen.line(c - 27 + i * 18, 4, c - 27 + i * 18, 58, l), gen.line(c - 27, 4 + i * 18, c + 27, 4 + i * 18, l)]), gen.circle(c + 18, 13, 8, l)];
    },
  },
  mitigation: {
    name: 'Mitigation',
    group: 'threat',
    keywords: 'countermeasure safeguard security control compensating remediation defense hardening patch',
    w: 100,
    h: 88,
    labelY: 78,
    draw: (o, w) => {
      const c = w / 2;
      return [shield(o, c), check(o, c, 33)];
    },
  },

  // Security: access
  mfa: {
    name: 'MFA',
    group: 'sec-access',
    keywords: 'multi factor two factor 2fa totp authenticator yubikey webauthn passkey fido duo otp',
    w: 90,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.path(roundRect(c - 18, 3, 36, 60, 7), o), check(o, c, 33)];
    },
  },
  pam: {
    name: 'Privileged access',
    group: 'sec-access',
    keywords: 'pam cyberark beyondtrust delinea teleport bastion jump host just in time break glass session recording',
    w: 130,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      const spokes = [0, 1, 2].map((i) => {
        const a = (i * Math.PI) / 3;
        return gen.line(c - 12 * Math.cos(a), 32 - 12 * Math.sin(a), c + 12 * Math.cos(a), 32 + 12 * Math.sin(a), l);
      });
      return [gen.rectangle(c - 34, 4, 68, 56, o), gen.circle(c, 32, 30, l), ...spokes, gen.line(c - 26, 60, c - 26, 65, l), gen.line(c + 26, 60, c + 26, 65, l)];
    },
  },
  ztna: tiled('Zero trust access', 'sec-access', 'ztna zero trust beyondcorp zscaler private access cloudflare access tailscale twingate identity aware proxy iap', glyph.key, 190),
  casb: tiled('Cloud access broker', 'sec-access', 'casb netskope defender for cloud apps shadow it saas security sase sse', glyph.eye, 200),
  nac: {
    name: 'Network access control',
    group: 'sec-access',
    keywords: 'nac 802.1x cisco ise aruba clearpass forescout posture check port security',
    w: 170,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 40, 8, 12, 54, o), gen.rectangle(c + 28, 8, 12, 54, o), gen.line(c - 28, 22, c + 28, 22, bold(o)), gen.line(c - 28, 40, c + 28, 40, l)];
    },
  },
  'iam-role': {
    name: 'Role',
    group: 'sec-access',
    keywords: 'iam role permission rbac least privilege assume role entitlement scope',
    w: 90,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.path(roundRect(c - 22, 6, 44, 56, 6), o), gen.line(c - 7, 13, c + 7, 13, bold(o)), gen.circle(c, 30, 14, l), gen.line(c - 12, 50, c + 12, 50, l)];
    },
  },
  'service-account': tiled('Service account', 'sec-access', 'service account workload identity machine identity spiffe spire irsa non human identity', glyph.robot, 180),
  credential: tiled('Credential', 'sec-access', 'credential password hash api key stolen leaked ssh bcrypt argon2', glyph.key, 150),
  'access-token': {
    name: 'Access token',
    group: 'sec-access',
    keywords: 'bearer jwt refresh session cookie oauth saml assertion paseto',
    w: 140,
    h: 64,
    labelY: 32,
    draw: (o, w) => [gen.path(`M6 8 H${w - 6} V24 A8 8 0 0 0 ${w - 6} 40 V56 H6 V40 A8 8 0 0 0 6 24 Z`, o)],
  },

  // Security: detection and response
  siem: {
    name: 'SIEM',
    group: 'sec-detect',
    keywords: 'siem splunk sentinel qradar elastic security wazuh chronicle log correlation detection rules',
    w: 110,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 36, 4, 72, 46, o), ...glyph.bars(o, c, 26), gen.line(c, 50, c, 60, l), gen.line(c - 18, 60, c + 18, 60, l)];
    },
  },
  soar: {
    name: 'SOAR',
    group: 'sec-detect',
    keywords: 'soar playbook xsoar phantom tines security automation orchestration response swimlane',
    w: 100,
    h: 86,
    labelY: 76,
    draw: (o, w) => [gen.circle(w / 2, 32, 56, o), ...glyph.cycle(o, w / 2, 32)],
  },
  edr: {
    name: 'EDR',
    group: 'sec-detect',
    keywords: 'edr xdr crowdstrike falcon sentinelone defender for endpoint carbon black antivirus endpoint agent',
    w: 120,
    h: 82,
    labelY: 72,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 30, 6, 60, 40, o), gen.path(`M${c - 42} 56 L${c - 30} 46 H${c + 30} L${c + 42} 56 Z`, o), gen.path(`M${c} 13 L${c + 11} 17 V26 Q${c + 11} 34 ${c} 39 Q${c - 11} 34 ${c - 11} 26 V17 Z`, l)];
    },
  },
  ndr: {
    name: 'NDR',
    group: 'sec-detect',
    keywords: 'ndr network detection darktrace vectra extrahop zeek packet capture netflow',
    w: 100,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c, 32, 56, o), gen.circle(c, 32, 30, l), gen.line(c, 32, c + 20, 12, bold(o)), gen.circle(c - 12, 20, 4, l)];
    },
  },
  honeypot: {
    name: 'Honeypot',
    group: 'sec-detect',
    keywords: 'honeypot honeytoken canary deception decoy thinkst tripwire',
    w: 100,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.path(`M${c - 24} 20 Q${c - 36} 62 ${c} 62 Q${c + 36} 62 ${c + 24} 20 Z`, o), gen.ellipse(c, 18, 54, 13, o)];
    },
  },
  'threat-intel': tiled('Threat intelligence', 'sec-detect', 'threat intel ioc indicators misp stix taxii feed virustotal recorded future', glyph.eye, 190),
  soc: {
    name: 'SOC',
    group: 'sec-detect',
    keywords: 'soc security operations center analyst blue mdr managed detection on call responder',
    w: 90,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [...person(o, c), gen.path(`M${c - 15} 16 A15 15 0 0 1 ${c + 15} 16`, bold(o)), gen.path(`M${c + 15} 16 Q${c + 15} 28 ${c + 4} 28`, l)];
    },
  },
  incident: {
    name: 'Incident',
    group: 'sec-detect',
    keywords: 'security incident breach response ir pagerduty containment postmortem forensics triage',
    w: 100,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [
        gen.path(`M${c - 18} 46 V30 A18 18 0 0 1 ${c + 18} 30 V46 Z`, o),
        gen.rectangle(c - 26, 46, 52, 12, o),
        gen.line(c, 4, c, 10, l),
        gen.line(c - 26, 12, c - 22, 17, l),
        gen.line(c + 26, 12, c + 22, 17, l),
      ];
    },
  },

  // Security: data protection
  dlp: {
    name: 'Data loss prevention',
    group: 'sec-data',
    keywords: 'dlp exfiltration purview macie symantec forcepoint data leak prevention',
    w: 170,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [page(o, c), gen.line(c - 11, 24, c + 11, 48, bold(l)), gen.line(c + 11, 24, c - 11, 48, bold(l))];
    },
  },
  hsm: {
    name: 'HSM',
    group: 'sec-data',
    keywords: 'hardware security module cloudhsm thales luna entrust nshield fips 140 tpm',
    w: 120,
    h: 74,
    labelY: 64,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 42, 8, 84, 42, o), gen.circle(c, 25, 12, l), gen.line(c, 30, c, 40, l), gen.circle(c + 30, 18, 5, l), gen.line(c - 34, 40, c - 18, 40, l)];
    },
  },
  'encryption-key': {
    name: 'Encryption key',
    group: 'sec-data',
    keywords: 'encryption dek kek cmk envelope rotation aes rsa at rest in transit',
    w: 130,
    h: 76,
    labelY: 66,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c - 30, 30, 36, o), gen.circle(c - 34, 30, 10, l), gen.line(c - 12, 30, c + 40, 30, bold(l)), gen.line(c + 24, 30, c + 24, 42, bold(l)), gen.line(c + 36, 30, c + 36, 40, bold(l))];
    },
  },
  tokenization: tiled('Tokenization', 'sec-data', 'tokenization vgs skyflow pci vault format preserving pseudonymization', glyph.arrows, 170),
  'data-masking': tiled('Data masking', 'sec-data', 'masking redaction anonymization obfuscation presidio de-identification', maskedEye, 170),
  'audit-log': tiled('Audit log', 'sec-data', 'audit trail cloudtrail immutable worm tamper evident accountability', glyph.list, 150),

  // Security: application security
  sast: tiled('Static analysis', 'sec-app', 'sast semgrep codeql checkmarx sonarqube secret scanning gitleaks linter', glyph.doc, 170),
  dast: tiled('Dynamic testing', 'sec-app', 'dast zap burp suite fuzzing iast nuclei', glyph.play, 170),
  sbom: tiled('SBOM', 'sec-app', 'software bill of materials cyclonedx spdx syft dependency inventory slsa provenance', glyph.list, 120),
  pentest: {
    name: 'Penetration test',
    group: 'sec-app',
    keywords: 'pentest red adversary simulation kali cobalt strike assessment',
    w: 140,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.circle(c, 32, 50, o), gen.circle(c, 32, 22, l), gen.line(c - 32, 32, c - 8, 32, l), gen.line(c + 8, 32, c + 32, 32, l), gen.line(c, 0, c, 24, l), gen.line(c, 40, c, 64, l)];
    },
  },
  cspm: {
    name: 'Cloud posture',
    group: 'sec-app',
    keywords: 'cspm cnapp wiz orca prisma cloud security hub defender for cloud prowler misconfiguration benchmark',
    w: 120,
    h: 80,
    labelY: 70,
    draw: (o, w) => [cloud(o, w, 58), check(o, w / 2, 34)],
  },
  mdm: tiled('Device management', 'sec-app', 'mdm intune jamf kandji workspace one byod fleet endpoint compliance', glyph.gear, 190),
  'code-signing': {
    name: 'Code signing',
    group: 'sec-app',
    keywords: 'sigstore cosign notary authenticode gpg artifact attestation integrity',
    w: 120,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [page(o, c), gen.line(c - 13, 22, c + 6, 22, l), gen.line(c - 13, 32, c + 12, 32, l), gen.circle(c + 8, 49, 16, o), gen.line(c + 3, 56, c + 1, 66, l), gen.line(c + 13, 56, c + 15, 66, l)];
    },
  },
  sandbox: {
    name: 'Sandbox',
    group: 'sec-app',
    keywords: 'isolation gvisor firecracker seccomp apparmor selinux wasm detonation browser isolation',
    w: 110,
    h: 84,
    labelY: 74,
    draw: (o, w) => {
      const c = w / 2, l = line(o);
      return [gen.rectangle(c - 34, 20, 68, 40, o), gen.linearPath([[c - 34, 20], [c - 46, 8], [c - 18, 8], [c, 20], [c + 18, 8], [c + 46, 8], [c + 34, 20]], l)];
    },
  },
  'compliance-control': {
    name: 'Compliance control',
    group: 'sec-app',
    keywords: 'soc 2 iso 27001 pci dss hipaa gdpr nist cis benchmark vanta drata audit evidence',
    w: 150,
    h: 86,
    labelY: 76,
    draw: (o, w) => {
      const c = w / 2;
      return [gen.rectangle(c - 24, 8, 48, 54, o), gen.rectangle(c - 10, 3, 20, 10, o), check(o, c, 36)];
    },
  },
  'bug-bounty': tiled('Bug bounty', 'sec-app', 'hackerone bugcrowd intigriti responsible disclosure vdp security.txt', glyph.star, 150),
  'email-security': tiled('Email security', 'sec-app', 'proofpoint mimecast abnormal anti-phishing spam filter dmarc dkim spf', envelope, 170),
} satisfies Partial<Record<ComponentType, Spec>>;
