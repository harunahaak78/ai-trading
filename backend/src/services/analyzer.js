import {
    confirmSetup
} from "../strategies/setupConfirmationEngine.js";

import {
    detectMarketStructure
} from "../strategies/marketStructure.js";

import {
    detectFairValueGap
} from "../strategies/fairValueGap.js";

import {
    detectLiquiditySweep
} from "../strategies/liquidity.js";

import {
    detectLiquidityEngine
} from "../strategies/liquidityEngine.js";

import {
    buildLiquidityMap
} from "../strategies/liquidityMap.js";

import {
    detectDisplacement
} from "../strategies/displacementEngine.js";

import {
    detectMarketEvent
} from "../strategies/marketEventEngine.js";

import {
    detectOrderBlock
} from "../strategies/orderBlock.js";

import {
    detectSupplyDemand
} from "../strategies/supplyDemand.js";

import {
    detectMarketSequence
} from "../strategies/marketSequenceEngine.js";

import {
    calculateEMA,
    calculateRSI
} from "../strategies/indicators.js";

import {
    calculateConfluence
} from "../strategies/confluence.js";

import {
    detectObFvgRetest
} from "../strategies/obFvgRetestEngine.js";

import {
    detectActiveSequence
} from "../strategies/activeSequenceEngine.js";
import { detectActiveEvent } from "../strategies/activeEventEngine.js";
import { reconcileMarketStructure } from "../strategies/structureReconciliationEngine.js";



export function analyzeMarket(candles) {

    if (!Array.isArray(candles)) {
        throw new Error(
            "Candles must be an array"
        );
    }

    if (candles.length < 20) {
        throw new Error(
            "At least 20 candles are required for analysis"
        );
    }


    /*
     * 1. MARKET STRUCTURE
     */

    const structure =
        detectMarketStructure(candles);


    /*
     * 2. OLD LIQUIDITY DETECTOR
     */

    const liquidity =
        detectLiquiditySweep(candles);


    /*
     * 3. LIQUIDITY ENGINE
     */

    const liquidityEngine =
        detectLiquidityEngine(candles);


    /*
     * 4. LIQUIDITY MAP
     */

    const liquidityMap =
        buildLiquidityMap(candles);


    /*
     * 5. DISPLACEMENT
     */

    const displacement =
        detectDisplacement(candles);


    /*
     * 6. MARKET EVENT
     */

    const marketEvent =
        detectMarketEvent({
            candles,
            liquidityMap,
            displacement,
            marketStructure: structure
        });


    /*
     * 7. MARKET SEQUENCE
     */

    const marketSequence =
        detectMarketSequence({
            candles,
            liquidityMap
        });


    /*
     * 8. ACTIVE SEQUENCE
     *
     * Determines whether the historical
     * sequence is still valid.
     */

    const activeSequence =
        detectActiveSequence({
            candles,
            marketStructure: structure,
            marketSequence
        });
    const activeEvent = 
        detectActiveEvent({
            marketEvent,
            marketSequence,
            activeSequence,
            marketStructure: structure
        });
    const structureReconciliation = 
        reconcileMarketStructure({
            analysis: {
                marketStructure: structure,
                marketSequence,
                activeSequence,
                activeEvent
            }
        });


    /*
     * 9. ORDER BLOCK
     */

    const orderBlock =
        detectOrderBlock(candles);


    /*
     * 10. FAIR VALUE GAP
     */

    const fvgZones =
        detectFairValueGap(candles);

    const latestFVG =
        fvgZones.length > 0
            ? fvgZones[fvgZones.length - 1]
            : {
                type: null,
                top: null,
                bottom: null
            };


    /*
     * 11. SUPPLY / DEMAND
     */

    const supplyDemand =
        detectSupplyDemand(candles);


    /*
     * 12. INDICATORS
     */

    const emaFast =
        calculateEMA(candles, 20);

    const emaSlow =
        calculateEMA(candles, 50);

    const rsi =
        calculateRSI(candles, 14);


    /*
     * 13. CONFLUENCE
     */

    const confluence =
        calculateConfluence({
            structure,
            liquidity,
            orderBlock,
            fairValueGap: latestFVG,
            supplyDemand,
            rsi,
            emaFast,
            emaSlow
        });


    /*
     * 14. SETUP CONFIRMATION
     */

    const setupConfirmation =
        confirmSetup({
            candles,
            marketEvent,
            displacement,
            marketStructure: structure,
            orderBlock,
            fairValueGap: latestFVG,
            supplyDemand,
            // Recent-history inputs: the sweep, displacement and BOS
            // rarely land on the same candle.
            marketSequence,
            activeSequence,
            structureReconciliation
        });


    /*
     * 15. OB + FVG RETEST
     *
     * Only pass the sequence as confirmed
     * when Active Sequence says it is active.
     */

    /*
 * 15. OB + FVG RETEST
 *
 * Only use a sequence that is still valid.
 * Structure reconciliation can invalidate an
 * older sequence after a confirmed reversal.
 */
    // const structureReconciliation = reconcileMarketStructure({
    //     analysis: {
    //         marketStructure: structure,
    //         marketSequence,
    //         activeSequence,
    //         activeEvent
    //     }
    // });
    
    const obFvgRetest = detectObFvgRetest({
        candles,
        // The retest engine needs a setup direction; without it
        // it returns early and the retest is never evaluated.
        direction: marketSequence?.direction || null,
        marketSequence,
        activeSequence,
        orderBlock,
        fairValueGaps: fvgZones,
        structureReconciliation
    });

    /*
     * 16. CURRENT PRICE
     */

    const currentPrice =
        candles[candles.length - 1].close;


    /*
     * 17. RETURN COMPLETE ANALYSIS
     */

    return {

        price:
            currentPrice,

        signal:
            confluence.direction,

        confidenceScore:
            confluence.confidenceScore,

        bullishScore:
            confluence.bullishScore,

        bearishScore:
            confluence.bearishScore,


        marketStructure:
            structure,


        liquidity:
            liquidity,


        liquidityEngine:
            liquidityEngine,


        liquidityMap:
            liquidityMap,


        displacement:
            displacement,


        marketEvent:
            marketEvent,


        marketSequence:
            marketSequence,


        activeSequence:
            activeSequence,
        activeEvent:
            activeEvent,
        structureReconciliation:
            structureReconciliation,


        setupConfirmation:
            setupConfirmation,


        obFvgRetest:
            obFvgRetest,


        orderBlock:
            orderBlock,


        fairValueGap:
            latestFVG,


        supplyDemand:
            supplyDemand,


        indicators: {

            ema20:
                emaFast,

            ema50:
                emaSlow,

            rsi
        },


        analyzedAt:
            new Date().toISOString()
    };
}