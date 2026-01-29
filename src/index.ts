import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';
import yieldData from './data/yields.json';

// Types
interface Pool {
  asset: string;
  apy: number;
  tvl: number;
  risk: string;
}

interface Protocol {
  name: string;
  chain: string;
  category: string;
  pools: Pool[];
}

// Create agent with extensions
const agent = await createAgent({
  name: 'defi-yield-agent',
  version: '1.0.0',
  description: 'Real-time DeFi yields, RWA opportunities, treasury rates, and risk analysis',
})
  .use(http())
  .use(payments({ 
    config: paymentsFromEnv(),
  }))
  .build();

// Create Hono app from agent
const { app, addEntrypoint } = await createAgentApp(agent);

// === FREE ENTRYPOINT ===
addEntrypoint({
  key: 'yields-summary',
  description: 'Basic market overview with total TVL and average yields (FREE)',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const protocols = yieldData.protocols as Protocol[];
    const totalTVL = protocols.reduce(
      (sum, p) => sum + p.pools.reduce((s, pool) => s + pool.tvl, 0),
      0
    );
    
    const avgYield = protocols.reduce((sum, p) => {
      const protocolAvg = p.pools.reduce((s, pool) => s + pool.apy, 0) / p.pools.length;
      return sum + protocolAvg;
    }, 0) / protocols.length;

    return {
      output: {
        market: {
          totalTVL: `$${(totalTVL / 1e9).toFixed(1)}B`,
          protocolCount: protocols.length,
          avgYield: `${avgYield.toFixed(1)}%`,
          lastUpdated: yieldData.lastUpdated,
        },
        treasuryRates: {
          "10Y": `${yieldData.treasuryRates.US["10Y"]}%`,
          "2Y": `${yieldData.treasuryRates.US["2Y"]}%`,
        },
        topCategories: ["RWA", "Lending", "Yield Trading"],
      },
    };
  },
});

// === PAID ENTRYPOINT 1: Top Yields ===
addEntrypoint({
  key: 'top-yields',
  description: 'Top yields across all DeFi protocols sorted by APY',
  input: z.object({
    limit: z.number().min(1).max(20).default(10),
    minTvl: z.number().default(0),
    risk: z.enum(['low', 'medium', 'high']).optional(),
  }),
  price: { amount: 1000 }, // $0.001 in microunits
  handler: async (ctx) => {
    const { limit, minTvl, risk } = ctx.input;
    const protocols = yieldData.protocols as Protocol[];
    const allPools: Array<Pool & { protocol: string; chain: string; category: string }> = [];

    for (const protocol of protocols) {
      for (const pool of protocol.pools) {
        if (pool.tvl >= minTvl && (!risk || pool.risk === risk)) {
          allPools.push({
            ...pool,
            protocol: protocol.name,
            chain: protocol.chain,
            category: protocol.category,
          });
        }
      }
    }

    const sorted = allPools.sort((a, b) => b.apy - a.apy).slice(0, limit);

    return {
      output: {
        topYields: sorted.map((p, i) => ({
          rank: i + 1,
          protocol: p.protocol,
          asset: p.asset,
          apy: `${p.apy}%`,
          tvl: `$${(p.tvl / 1e6).toFixed(1)}M`,
          chain: p.chain,
          category: p.category,
          risk: p.risk,
        })),
        filters: { limit, minTvl, risk: risk || 'all' },
      },
    };
  },
});

// === PAID ENTRYPOINT 2: Protocol Deep Dive ===
addEntrypoint({
  key: 'protocol-details',
  description: 'Deep dive analysis on a specific DeFi protocol',
  input: z.object({
    name: z.string().min(1),
  }),
  price: { amount: 2000 }, // $0.002
  handler: async (ctx) => {
    const { name } = ctx.input;
    const protocols = yieldData.protocols as Protocol[];
    
    const protocol = protocols.find(
      (p) => p.name.toLowerCase().includes(name.toLowerCase())
    );

    if (!protocol) {
      return {
        output: { 
          error: 'Protocol not found', 
          available: protocols.map(p => p.name) 
        },
      };
    }

    const totalTVL = protocol.pools.reduce((sum, p) => sum + p.tvl, 0);
    const avgAPY = protocol.pools.reduce((sum, p) => sum + p.apy, 0) / protocol.pools.length;
    const bestPool = protocol.pools.reduce((best, p) => p.apy > best.apy ? p : best);
    const safestPool = protocol.pools.filter(p => p.risk === 'low').sort((a, b) => b.apy - a.apy)[0];

    return {
      output: {
        protocol: {
          name: protocol.name,
          chain: protocol.chain,
          category: protocol.category,
          totalTVL: `$${(totalTVL / 1e9).toFixed(2)}B`,
          avgAPY: `${avgAPY.toFixed(2)}%`,
        },
        pools: protocol.pools.map(p => ({
          asset: p.asset,
          apy: `${p.apy}%`,
          tvl: `$${(p.tvl / 1e6).toFixed(1)}M`,
          risk: p.risk,
        })),
        recommendations: {
          bestYield: { asset: bestPool.asset, apy: `${bestPool.apy}%`, risk: bestPool.risk },
          safestOption: safestPool ? { asset: safestPool.asset, apy: `${safestPool.apy}%` } : null,
        },
      },
    };
  },
});

// === PAID ENTRYPOINT 3: RWA Opportunities ===
addEntrypoint({
  key: 'rwa-opportunities',
  description: 'Real World Asset investment opportunities',
  input: z.object({
    accreditedOnly: z.boolean().default(false),
    maxMinInvestment: z.number().default(1000000),
  }),
  price: { amount: 3000 }, // $0.003
  handler: async (ctx) => {
    const { accreditedOnly, maxMinInvestment } = ctx.input;

    let opportunities = yieldData.rwaOpportunities;
    
    if (accreditedOnly) {
      opportunities = opportunities.filter(o => o.accredited);
    }
    opportunities = opportunities.filter(o => o.minInvestment <= maxMinInvestment);

    const rwaProtocols = (yieldData.protocols as Protocol[]).filter(p => p.category === 'RWA');

    return {
      output: {
        rwaMarket: {
          totalOpportunities: opportunities.length + rwaProtocols.length,
          avgYield: `${(opportunities.reduce((s, o) => s + o.yield, 0) / opportunities.length).toFixed(1)}%`,
          trend: 'growing',
        },
        tokenizedProducts: opportunities.map(o => ({
          name: o.name,
          type: o.type,
          yield: `${o.yield}%`,
          minInvestment: `$${o.minInvestment.toLocaleString()}`,
          chain: o.chain,
          accreditedOnly: o.accredited,
        })),
        onChainRWA: rwaProtocols.map(p => ({
          protocol: p.name,
          pools: p.pools.map(pool => ({
            asset: pool.asset,
            apy: `${pool.apy}%`,
            tvl: `$${(pool.tvl / 1e6).toFixed(0)}M`,
          })),
        })),
        treasuryComparison: {
          'US 10Y Treasury': `${yieldData.treasuryRates.US['10Y']}%`,
          note: 'RWA yields often backed by similar instruments',
        },
      },
    };
  },
});

// === PAID ENTRYPOINT 4: Yield Comparison ===
addEntrypoint({
  key: 'yield-compare',
  description: 'Compare yields for a specific asset across protocols',
  input: z.object({
    asset: z.string().default('USDC'),
    chains: z.array(z.string()).optional(),
  }),
  price: { amount: 2000 }, // $0.002
  handler: async (ctx) => {
    const { asset, chains } = ctx.input;
    const protocols = yieldData.protocols as Protocol[];
    
    const comparisons: Array<{
      protocol: string;
      chain: string;
      apy: number;
      tvl: number;
      risk: string;
    }> = [];

    for (const protocol of protocols) {
      if (chains && chains.length > 0 && !chains.includes(protocol.chain.toLowerCase())) continue;
      
      for (const pool of protocol.pools) {
        if (pool.asset.toUpperCase().includes(asset.toUpperCase())) {
          comparisons.push({
            protocol: protocol.name,
            chain: protocol.chain,
            apy: pool.apy,
            tvl: pool.tvl,
            risk: pool.risk,
          });
        }
      }
    }

    const sorted = comparisons.sort((a, b) => b.apy - a.apy);
    const best = sorted[0];
    const safest = sorted.filter(c => c.risk === 'low').sort((a, b) => b.apy - a.apy)[0];

    return {
      output: {
        asset,
        comparisons: sorted.map(c => ({
          protocol: c.protocol,
          chain: c.chain,
          apy: `${c.apy}%`,
          tvl: `$${(c.tvl / 1e6).toFixed(0)}M`,
          risk: c.risk,
        })),
        recommendation: {
          highestYield: best ? { protocol: best.protocol, apy: `${best.apy}%`, risk: best.risk } : null,
          bestRiskAdjusted: safest ? { protocol: safest.protocol, apy: `${safest.apy}%` } : null,
          spread: best && safest ? `${(best.apy - safest.apy).toFixed(1)}% yield premium for higher risk` : null,
        },
      },
    };
  },
});

// === PAID ENTRYPOINT 5: Risk Analysis ===
addEntrypoint({
  key: 'risk-analysis',
  description: 'Risk-adjusted yield analysis with Sharpe ratio proxy and portfolio suggestions',
  input: z.object({}),
  price: { amount: 5000 }, // $0.005
  handler: async () => {
    const protocols = yieldData.protocols as Protocol[];
    const riskMultipliers = { low: 1.0, medium: 0.7, high: 0.4 };
    
    const analyzed: Array<{
      protocol: string;
      asset: string;
      rawAPY: number;
      riskAdjustedAPY: number;
      risk: string;
      tvl: number;
      sharpeProxy: number;
    }> = [];

    for (const protocol of protocols) {
      for (const pool of protocol.pools) {
        const riskMult = riskMultipliers[pool.risk as keyof typeof riskMultipliers] || 0.5;
        const riskAdjusted = pool.apy * riskMult;
        const riskFreeRate = yieldData.treasuryRates.US['3M'];
        const sharpeProxy = (pool.apy - riskFreeRate) / (pool.risk === 'low' ? 2 : pool.risk === 'medium' ? 5 : 10);

        analyzed.push({
          protocol: protocol.name,
          asset: pool.asset,
          rawAPY: pool.apy,
          riskAdjustedAPY: riskAdjusted,
          risk: pool.risk,
          tvl: pool.tvl,
          sharpeProxy,
        });
      }
    }

    const byRiskAdjusted = [...analyzed].sort((a, b) => b.riskAdjustedAPY - a.riskAdjustedAPY);
    const bySharpe = [...analyzed].sort((a, b) => b.sharpeProxy - a.sharpeProxy);

    return {
      output: {
        methodology: {
          riskMultipliers,
          riskFreeRate: `${yieldData.treasuryRates.US['3M']}% (3M Treasury)`,
          note: 'Sharpe proxy = (APY - risk-free) / volatility estimate',
        },
        topRiskAdjusted: byRiskAdjusted.slice(0, 10).map(a => ({
          protocol: a.protocol,
          asset: a.asset,
          rawAPY: `${a.rawAPY}%`,
          riskAdjustedAPY: `${a.riskAdjustedAPY.toFixed(1)}%`,
          risk: a.risk,
          tvl: `$${(a.tvl / 1e6).toFixed(0)}M`,
        })),
        topSharpeRatio: bySharpe.slice(0, 5).map(a => ({
          protocol: a.protocol,
          asset: a.asset,
          sharpeProxy: a.sharpeProxy.toFixed(2),
          apy: `${a.rawAPY}%`,
          risk: a.risk,
        })),
        portfolioSuggestion: {
          conservative: byRiskAdjusted.filter(a => a.risk === 'low').slice(0, 3).map(a => `${a.protocol} ${a.asset}`),
          balanced: byRiskAdjusted.filter(a => a.risk !== 'high').slice(0, 5).map(a => `${a.protocol} ${a.asset}`),
          aggressive: byRiskAdjusted.slice(0, 5).map(a => `${a.protocol} ${a.asset}`),
        },
      },
    };
  },
});

// Export for Bun server
const port = Number(process.env.PORT ?? 3000);
console.log(`🦞 DeFi Yield Agent running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
