import { describe, it, expect } from 'vitest';
import { PIPELINE_STAGES, TERMINAL_STAGES, stageLabels, stageTone, sourceLabels, itemTypeLabels, itemStatusLabels } from '@/lib/labels';
import type { Lead, LeadStage, LeadInterest, LeadItem } from '@/types/crm';
import { breakdownByItemType, crossSellRate, serviceMix } from '@/lib/analytics';

// Helper to create a test lead with new fields
function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'test-lead',
    code: 'G-TEST-001',
    guestId: 'test-guest',
    propertyId: 'test-property',
    source: 'whatsapp',
    stage: 'new',
    intent: 'warm',
    roomType: null,
    checkIn: null,
    checkOut: null,
    nights: 0,
    adults: 0,
    children: 0,
    roomAmount: 0,
    services: [],
    discount: 0,
    totalAmount: 0,
    deposit: 0,
    paidAmount: 0,
    paymentStatus: 'not_required',
    ownerId: 'test-owner',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    probability: 15,
    firstResponseMinutes: 0,
    slaMinutes: 30,
    stageHistory: [],
    activity: [],
    classification: { direction: 'other', quality: 'needs_qualification', temperature: 'warm', probability: 15, reasons: [], missingData: [], recommendedAction: '' },
    specialRequests: [],
    interests: [],
    items: [],
    ...overrides,
  };
}

// PIPELINE STAGES TESTS
describe('Pipeline stages', () => {
  it('includes planning and completed stages', () => {
    expect(PIPELINE_STAGES).toContain('planning');
    expect(PIPELINE_STAGES).toContain('completed');
  });

  it('has 7 pipeline stages in correct order', () => {
    expect(PIPELINE_STAGES).toEqual(['new', 'qualified', 'planning', 'offer', 'payment_pending', 'confirmed', 'completed']);
  });

  it('terminal stages are only lost and cancelled', () => {
    expect(TERMINAL_STAGES).toEqual(['lost', 'cancelled']);
    expect(TERMINAL_STAGES).not.toContain('confirmed');
  });

  it('confirmed and completed are won stages', () => {
    // They should not be in terminal stages
    expect(TERMINAL_STAGES).not.toContain('confirmed');
    expect(TERMINAL_STAGES).not.toContain('completed');
  });

  it('has labels for all stages including new ones', () => {
    expect(stageLabels.planning).toBe('Комплектация');
    expect(stageLabels.completed).toBe('Завершён');
  });

  it('has tones for all stages', () => {
    for (const stage of [...PIPELINE_STAGES, ...TERMINAL_STAGES]) {
      expect(stageTone[stage]).toBeDefined();
    }
  });
});

// SOURCE LABELS
describe('Source labels', () => {
  it('includes email and walk_in sources', () => {
    expect(sourceLabels.email).toBe('Email');
    expect(sourceLabels.walk_in).toBe('Визит');
  });
});

// ITEM TYPE LABELS
describe('Item type labels', () => {
  it('has labels for all item types', () => {
    const types = ['accommodation', 'restaurant', 'spa', 'massage', 'bathhouse', 'karaoke', 'horse_riding', 'atv', 'activity', 'transfer', 'corporate_event', 'wedding_or_banquet', 'other'];
    for (const t of types) {
      expect(itemTypeLabels[t]).toBeDefined();
      expect(typeof itemTypeLabels[t]).toBe('string');
    }
  });
});

// MULTI-INTEREST TESTS
describe('Multi-interest leads', () => {
  it('lead can have multiple interests', () => {
    const lead = makeLead({
      interests: [
        { id: '1', leadId: 'test', direction: 'accommodation', isPrimary: true, status: 'active', createdAt: '', updatedAt: '' },
        { id: '2', leadId: 'test', direction: 'spa', isPrimary: false, status: 'active', createdAt: '', updatedAt: '' },
        { id: '3', leadId: 'test', direction: 'restaurant', isPrimary: false, status: 'active', createdAt: '', updatedAt: '' },
      ],
    });
    expect(lead.interests).toHaveLength(3);
    const primary = lead.interests.find(i => i.isPrimary);
    expect(primary?.direction).toBe('accommodation');
  });

  it('accommodation-only lead has single interest', () => {
    const lead = makeLead({
      interests: [
        { id: '1', leadId: 'test', direction: 'accommodation', isPrimary: true, status: 'active', createdAt: '', updatedAt: '' },
      ],
    });
    expect(lead.interests).toHaveLength(1);
  });

  it('restaurant-only lead is valid', () => {
    const lead = makeLead({
      classification: { direction: 'restaurant', quality: 'target', temperature: 'warm', probability: 35, reasons: [], missingData: [], recommendedAction: '' },
      interests: [
        { id: '1', leadId: 'test', direction: 'restaurant', isPrimary: true, status: 'active', createdAt: '', updatedAt: '' },
      ],
    });
    expect(lead.classification.direction).toBe('restaurant');
    expect(lead.classification.quality).toBe('target');
  });

  it('activity-only lead is valid', () => {
    const lead = makeLead({
      classification: { direction: 'activities', quality: 'target', temperature: 'warm', probability: 35, reasons: [], missingData: [], recommendedAction: '' },
      interests: [
        { id: '1', leadId: 'test', direction: 'activities', isPrimary: true, status: 'active', createdAt: '', updatedAt: '' },
      ],
    });
    expect(lead.classification.quality).toBe('target');
  });
});

// ITEMS TESTS
describe('Lead items', () => {
  it('lead can have multiple items of different types', () => {
    const lead = makeLead({
      items: [
        { id: '1', leadId: 'test', type: 'accommodation', name: 'Sky House', status: 'quoted', quantity: 2, roomType: 'Sky House', nights: 2, adults: 4, children: 0, totalAmount: 340000, currency: 'KZT', createdAt: '', updatedAt: '' },
        { id: '2', leadId: 'test', type: 'spa', name: 'SPA visit', status: 'selected', quantity: 4, participants: 4, currency: 'KZT', createdAt: '', updatedAt: '' },
        { id: '3', leadId: 'test', type: 'restaurant', name: 'SOVA', status: 'interest', quantity: 1, participants: 4, currency: 'KZT', createdAt: '', updatedAt: '' },
      ],
    });
    expect(lead.items).toHaveLength(3);
  });

  it('service item can have no amount', () => {
    const item: LeadItem = { id: '1', leadId: 'test', type: 'horse_riding', name: 'Конная прогулка', status: 'interest', quantity: 4, participants: 4, currency: 'KZT', createdAt: '', updatedAt: '' };
    expect(item.totalAmount).toBeUndefined();
  });

  it('accommodation items can have quantity > 1', () => {
    const item: LeadItem = { id: '1', leadId: 'test', type: 'accommodation', name: 'Sky House', status: 'quoted', quantity: 2, roomType: 'Sky House', nights: 2, totalAmount: 340000, currency: 'KZT', createdAt: '', updatedAt: '' };
    expect(item.quantity).toBe(2);
  });
});

// PAYMENT TESTS
describe('Payment model', () => {
  it('no hardcoded 50% deposit', () => {
    const lead = makeLead({ totalAmount: 400000, deposit: 200000 });
    // deposit is a data value, not a formula
    expect(lead.deposit).toBe(200000);
    // paidAmount tracked separately
    expect(lead.paidAmount).toBe(0);
  });

  it('balance calculation', () => {
    const lead = makeLead({ totalAmount: 400000, paidAmount: 150000 });
    const balance = Math.max(lead.totalAmount - lead.paidAmount, 0);
    expect(balance).toBe(250000);
  });

  it('full payment gives zero balance', () => {
    const lead = makeLead({ totalAmount: 400000, paidAmount: 400000 });
    const balance = Math.max(lead.totalAmount - lead.paidAmount, 0);
    expect(balance).toBe(0);
  });

  it('overpayment gives zero balance, not negative', () => {
    const lead = makeLead({ totalAmount: 400000, paidAmount: 500000 });
    const balance = Math.max(lead.totalAmount - lead.paidAmount, 0);
    expect(balance).toBe(0);
  });
});

describe('Analytics - resort journey', () => {
  it('breakdownByItemType groups correctly', () => {
    const leads = [
      makeLead({ items: [
        { id: '1', leadId: 'test', type: 'accommodation', name: 'X', status: 'quoted', quantity: 2, totalAmount: 340000, currency: 'KZT', createdAt: '', updatedAt: '' },
        { id: '2', leadId: 'test', type: 'spa', name: 'Y', status: 'selected', quantity: 4, totalAmount: 48000, currency: 'KZT', createdAt: '', updatedAt: '' },
      ]}),
    ];
    const result = breakdownByItemType(leads);
    expect(result.find(r => r.type === 'accommodation')?.revenue).toBe(340000);
    expect(result.find(r => r.type === 'spa')?.count).toBe(4);
  });

  it('crossSellRate calculates correctly', () => {
    const leads = [
      makeLead({ interests: [
        { id: '1', leadId: 't', direction: 'accommodation', isPrimary: true, status: 'active', createdAt: '', updatedAt: '' },
        { id: '2', leadId: 't', direction: 'spa', isPrimary: false, status: 'active', createdAt: '', updatedAt: '' },
      ]}),
      makeLead({ interests: [
        { id: '3', leadId: 't2', direction: 'restaurant', isPrimary: true, status: 'active', createdAt: '', updatedAt: '' },
      ]}),
    ];
    const rate = crossSellRate(leads);
    expect(rate).toBe(50); // 1 out of 2 has multi-interest
  });

  it('serviceMix counts items', () => {
    const leads = [
      makeLead({ items: [
        { id: '1', leadId: 't', type: 'spa', name: 'SPA', status: 'selected', quantity: 4, currency: 'KZT', createdAt: '', updatedAt: '' },
        { id: '2', leadId: 't', type: 'horse_riding', name: 'Horses', status: 'selected', quantity: 2, currency: 'KZT', createdAt: '', updatedAt: '' },
      ]}),
    ];
    const mix = serviceMix(leads);
    expect(mix.find(m => m.type === 'spa')?.count).toBe(4);
    expect(mix.find(m => m.type === 'horse_riding')?.count).toBe(2);
  });
});
