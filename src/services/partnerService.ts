interface Partner {
  name: string;
  icon: string;
  link?: string;
  id: string;
  documentation?: string;
  git_repo?: string;
  tooltip?: string;
}



class PartnerService {
  private partners: Partner[] | null = null;
  private partnerMap: Map<string, Partner> | null = null;
  private fetchPromise: Promise<Partner[]> | null = null;

  async fetchPartners(): Promise<Partner[]> {
    // Return cached data if available
    if (this.partners) {
      return this.partners;
    }

    // Return existing promise if a fetch is already in progress
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    // Start a new fetch
    this.fetchPromise = this.doFetch();

    try {
      this.partners = await this.fetchPromise;
      this.buildPartnerMap();
      return this.partners;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async doFetch(): Promise<Partner[]> {
    const response = await fetch('/partners.json');
    if (!response.ok) {
      throw new Error('Failed to fetch partners');
    }
    const partners: Partner[] = await response.json();
    return partners;
  }

  private buildPartnerMap() {
    if (!this.partners) return;

    this.partnerMap = new Map();
    for (const partner of this.partners) {
      // Index by id (exact match)
      this.partnerMap.set(partner.id.toLowerCase(), partner);

      // Also index by name for fuzzy matching
      this.partnerMap.set(partner.name.toLowerCase(), partner);

      // Index by name without special characters for better matching
      const cleanName = partner.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanName) {
        this.partnerMap.set(cleanName, partner);
      }
    }
  }

  getPartnerByName(name: string): Partner | undefined {
    if (!this.partnerMap) return undefined;

    const searchName = name.toLowerCase();

    // Try exact match first
    let partner = this.partnerMap.get(searchName);
    if (partner) return partner;

    // Try without special characters
    const cleanName = searchName.replace(/[^a-z0-9]/g, '');
    partner = this.partnerMap.get(cleanName);
    if (partner) return partner;

    // Try partial match (search name contains partner name or vice versa)
    for (const [key, value] of this.partnerMap.entries()) {
      if (key.includes(searchName) || searchName.includes(key)) {
        return value;
      }
    }

    return undefined;
  }

  getPartnerIcon(name: string): string | undefined {
    const partner = this.getPartnerByName(name);
    return partner?.icon;
  }

  getAllPartners(): Partner[] {
    return this.partners || [];
  }

  clearCache() {
    this.partners = null;
    this.partnerMap = null;
    this.fetchPromise = null;
  }
}

// Export a singleton instance
export const partnerService = new PartnerService();
export type { Partner };
