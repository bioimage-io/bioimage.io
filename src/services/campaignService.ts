import { HYPHA_SERVER_URL } from '../config/hypha';
import {
  CAMPAIGN_SCHEMA_VERSION,
  CampaignListResponse,
  CampaignRecord,
  CampaignSummary,
  JoinRequest,
  JoinRequestReceipt,
} from '../types/campaign';

/**
 * Reads the federation campaign registry.
 *
 * Two properties matter more than anything else here:
 *
 * 1. **A failed read renders nothing, never a fixture.** The fixture seam is
 *    opt-in through `REACT_APP_CAMPAIGN_FIXTURES` and is checked BEFORE any
 *    network call, never in a catch block. That makes "renders nothing" the
 *    default by construction instead of something we have to remember, which
 *    is what the product brief requires of the deployed page: it shows what
 *    the campaign service reports, or it shows an empty state.
 * 2. **Reads are unauthenticated HTTP.** Hypha exposes every service method
 *    over plain HTTP, so the campaign pages work logged out and do not wait on
 *    a websocket. Same approach as `useCellpose3Runner.ts`.
 */

// Unqualified on purpose, so the read load-balances across whichever workers
// register the app. `_mode` is then mandatory: an unmoded GET against an
// unqualified id answers 400 ("Multiple services found") as soon as a second
// worker registers it. `first` is right for these reads because every replica
// serves the same registry.
const CAMPAIGN_SERVICE_ID =
  process.env.REACT_APP_CAMPAIGN_SERVICE_ID || 'bioimage-io/federation-campaign';

const SERVICE_BASE_URL =
  `${HYPHA_SERVER_URL}/${CAMPAIGN_SERVICE_ID.replace('/', '/services/')}`;

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Fixtures exist so the page can be designed and reviewed before the backend
 * lands. They are compiled out of a production build, which has no way to
 * switch them on.
 */
export const CAMPAIGN_FIXTURE_MODE = process.env.REACT_APP_CAMPAIGN_FIXTURES === '1';

/** The banner text shown on every campaign screen while fixtures are on. */
export const CAMPAIGN_FIXTURE_NOTICE =
  'Prototype data. Every figure on this page is illustrative, not measured.';

export class CampaignSchemaMismatchError extends Error {
  constructor(public readonly received: string) {
    super(
      `Campaign service reports schema ${received}, this page expects ${CAMPAIGN_SCHEMA_VERSION}`
    );
    this.name = 'CampaignSchemaMismatchError';
  }
}

async function getJson<T>(method: string, params?: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ _mode: 'first', ...(params || {}) });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVICE_BASE_URL}/${method}?${query.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`federation-campaign responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(deadline);
  }
}

async function postJson<T>(method: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${SERVICE_BASE_URL}/${method}?_mode=first`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`federation-campaign responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * A response whose schema version we do not recognise is refused rather than
 * rendered optimistically. Field-by-field a mismatched record can look fine
 * while a renamed unit turns a byte count into a megabyte count, and this page
 * only has value if what it displays is exactly what was measured.
 *
 * This guards BOTH read paths. It once guarded only `get_campaign`, which left
 * the index, the first thing anyone loads, with no version handshake at all.
 *
 * It is exercised in the failing direction by the schema-mismatch tests in
 * tests/campaigns-page.spec.ts, and that is not a formality. Every assertion
 * around this guard is negative ("no mismatched record renders"), and a
 * negative assertion passes identically when the guard works and when it has
 * been broken. Without a case that makes it throw, the green tick is the same
 * tick either way. If you change this function, keep a test that proves it can
 * still refuse something.
 */
function assertSchema(record: { schema_version?: string }): void {
  const received = record.schema_version;
  if (!received) throw new CampaignSchemaMismatchError('none');
  const major = (v: string) => v.split('.').slice(0, 2).join('.');
  if (major(received) !== major(CAMPAIGN_SCHEMA_VERSION)) {
    throw new CampaignSchemaMismatchError(received);
  }
}

class CampaignService {
  private summaries: CampaignSummary[] | null = null;
  private summariesPromise: Promise<CampaignSummary[]> | null = null;
  private records = new Map<string, CampaignRecord>();
  private recordPromises = new Map<string, Promise<CampaignRecord>>();

  /** Every campaign the service knows about. Empty array is a valid answer. */
  async listCampaigns(): Promise<CampaignSummary[]> {
    if (this.summaries) return this.summaries;
    if (this.summariesPromise) return this.summariesPromise;

    this.summariesPromise = this.doListCampaigns();
    try {
      this.summaries = await this.summariesPromise;
      return this.summaries;
    } finally {
      this.summariesPromise = null;
    }
  }

  private async doListCampaigns(): Promise<CampaignSummary[]> {
    // Written out in full rather than going through CAMPAIGN_FIXTURE_MODE so
    // the bundler can fold the branch away and drop the fixture module from
    // the graph entirely. An emitted-but-unreachable chunk is still a served
    // file full of invented numbers.
    //
    // This half only works because .env.production DEFINES the variable. CRA
    // gives DefinePlugin no entry for an unset REACT_APP_* var, and without an
    // entry the comparison is not statically foldable. Both halves are load
    // bearing; see the comment in .env.production.
    if (process.env.REACT_APP_CAMPAIGN_FIXTURES === '1') {
      const { FIXTURE_CAMPAIGN_SUMMARIES } = await import('./__fixtures__/campaigns');
      return FIXTURE_CAMPAIGN_SUMMARIES;
    }
    const response = await getJson<CampaignListResponse>('list_campaigns');
    // Checked BEFORE the array is touched. A drifted service that still
    // happens to return a well-formed array is the case this exists for, so
    // shape-looks-fine must not be allowed to stand in for version-agrees.
    assertSchema(response);
    const campaigns = response?.campaigns;
    return Array.isArray(campaigns) ? campaigns : [];
  }

  /** One campaign in full. Throws if the service is unreachable or disagrees on the schema. */
  async getCampaign(campaignId: string): Promise<CampaignRecord> {
    const cached = this.records.get(campaignId);
    if (cached) return cached;
    const pending = this.recordPromises.get(campaignId);
    if (pending) return pending;

    const promise = this.doGetCampaign(campaignId);
    this.recordPromises.set(campaignId, promise);
    try {
      const record = await promise;
      this.records.set(campaignId, record);
      return record;
    } finally {
      this.recordPromises.delete(campaignId);
    }
  }

  private async doGetCampaign(campaignId: string): Promise<CampaignRecord> {
    // Inline for the same reason as doListCampaigns above.
    if (process.env.REACT_APP_CAMPAIGN_FIXTURES === '1') {
      const { FIXTURE_CAMPAIGNS } = await import('./__fixtures__/campaigns');
      const record = FIXTURE_CAMPAIGNS[campaignId];
      if (!record) throw new Error(`No fixture campaign "${campaignId}"`);
      return record;
    }
    const record = await getJson<CampaignRecord>('get_campaign', { campaign_id: campaignId });
    assertSchema(record);
    return record;
  }

  /**
   * Ask a steward for permission to join. Deliberately a request: nothing is
   * deployed to the requesting site until a human accepts.
   */
  async submitJoinRequest(request: JoinRequest): Promise<JoinRequestReceipt> {
    if (CAMPAIGN_FIXTURE_MODE) {
      return {
        request_id: `fixture-${request.campaign_id}`,
        status: 'pending',
        message: 'Prototype mode. No request was sent.',
      };
    }
    return postJson<JoinRequestReceipt>('submit_join_request', request);
  }

  /** Drop the caches so the next read hits the service again. */
  invalidate(): void {
    this.summaries = null;
    this.records.clear();
  }
}

export const campaignService = new CampaignService();
