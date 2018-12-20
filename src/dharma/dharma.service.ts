import { Injectable, Inject } from '@nestjs/common';
import { TokenSymbol, Address } from 'src/types';
import Axios from 'axios';
import { stringify } from 'qs';
import { Agent } from 'https';
import { Wallet } from 'ethers';
import { CollateralizedSimpleInterestLoanAdapter } from './collateralized-simple-interest-loan-adapter';
import { TokenAmount, MaxLTVLoanOffer, TimeInterval, InterestRate } from 'dharma-max-ltv-fork/build/js/typescript/types';
import { BigNumber } from 'dharma-max-ltv-fork/build/js/typescript/utils';
import * as ProviderBridge from 'ethers-web3-bridge';
import { MaxLTVData, CreditorValues } from 'dharma-max-ltv-fork/build/js/typescript/types/loan_offer/max_ltv_loan_offer';
import { Price } from 'dharma-max-ltv-fork/build/js/types/LTVTypes';

@Injectable()
export class DharmaService {

    constructor(
        @Inject('wallet') private readonly wallet: Wallet,
        @Inject('bloqboard-uri') private readonly bloqboardUri: string,
        @Inject('currency-rates-uri') private readonly currencyRatesUrl: string,
        @Inject('dharma-kernel-address') private readonly dharmaKernelAddress: Address,
        @Inject('creditor-proxy-address') private readonly creditorProxyAddress: Address,
        private readonly loadAdapter: CollateralizedSimpleInterestLoanAdapter,
    ) { }

    async getLendOffers(principalToken?: TokenSymbol, collateralToken?: TokenSymbol, minUsdAmount?: number): Promise<any[]> {
        const res = await this.fetchLendOffers();

        return res;
    }

    async fillLendOffer(offerId: string): Promise<string> {
        const rawOffer = await this.fetchLendOffer(offerId);
        const { offer, principal, collateral } = await this.convertLendOfferToProxyInstance(rawOffer);

        const principalPrice = await this.getSignedRate(principal.tokenSymbol, 'USD');
        const collateralPrice = await this.getSignedRate(collateral.tokenSymbol, 'USD');

        const collateralAmount = this.calculateCollateral(
            principal.rawAmount,
            principalPrice.value,
            collateralPrice.value,
            collateral.tokenSymbol,
            rawOffer.maxLtv,
        );

        offer.setPrincipalPrice(principalPrice);
        offer.setCollateralPrice(collateralPrice);
        offer.setCollateralAmount(new BigNumber(collateralAmount.decimalAmount.toString()));

        const debtor = this.wallet.address.toLowerCase();
        await offer.signAsDebtor(debtor, false);
        const txHash = await offer.acceptAsDebtor(debtor, { gasPrice: '5000000000', from: debtor });

        return txHash;
    }

    private calculateCollateral(
        principalAmount: BigNumber,
        principalAmountUsdRate: number,
        collateralUsdRate: number,
        collateralTokenSymbol: string,
        ltv: number,
    ): TokenAmount {
        const usdAmount = principalAmount.times(principalAmountUsdRate);
        const usdCollateral = usdAmount.div(new BigNumber(ltv).div(100));
        const collateral = usdCollateral.div(collateralUsdRate).mul(1.01);
        return TokenAmount.fromRaw(collateral, collateralTokenSymbol);
    }

    private async fetchLendOffer(offerId: string) {
        const debtsUrl = `${this.bloqboardUri}/Debts`;
        const response = await Axios.get(`${debtsUrl}/${offerId}`, {
            httpsAgent: new Agent({ rejectUnauthorized: false }),
        });

        return response.data;
    }

    private async fetchLendOffers() {
        const debtsUrl = `${this.bloqboardUri}/Debts`;
        const kernelAddress = this.dharmaKernelAddress;
        const pagination = {};
        const sorting = {};
        const filter = {};
        const response = await Axios.get(debtsUrl, {
            params: {
                status: 'SignedByCreditor', ...pagination, kernelAddress, ...sorting, ...filter,
            },
            paramsSerializer: (params) => stringify(params, { allowDots: true, arrayFormat: 'repeat' }),
            httpsAgent: new Agent({ rejectUnauthorized: false }),
        });

        return response.data;
    }

    private async getSignedRate(source: string, target: string): Promise<Price> {
        const signedRatesApiUrl = this.currencyRatesUrl;
        const url = `${signedRatesApiUrl}/api/v0/rates/signed/${source}/${target}`;
        const result = await Axios.get(url, {
            httpsAgent: new Agent({ rejectUnauthorized: false }),
        });
        return {
            value: result.data.rate,
            tokenAddress: result.data.targetCurrencyTokenAddress,
            timestamp: result.data.timeStamp,
            signature: {
                v: parseInt(result.data.signature.v, 16),
                r: `0x${result.data.signature.r}`,
                s: `0x${result.data.signature.s}`,
            },
        };
    }

    // TODO: TEST THIS THROUGHLY
    private async convertLendOfferToProxyInstance(relayerLendOffer: any) {
        if (relayerLendOffer.maxLtv === undefined) {
            console.error('maxLtv is undefined in lend offer:', relayerLendOffer);
        }

        const parsedOffer = await this.loadAdapter.fromDebtOrder({
            kernelVersion: relayerLendOffer.kernelAddress,
            issuanceVersion: relayerLendOffer.repaymentRouterAddress,
            principalAmount: new BigNumber(relayerLendOffer.principalAmount || 0),
            principalToken: relayerLendOffer.principalTokenAddress,
            debtor: relayerLendOffer.debtorAddress,
            debtorFee: new BigNumber(relayerLendOffer.debtorFee || 0),
            termsContract: relayerLendOffer.termsContractAddress,
            termsContractParameters: relayerLendOffer.termsContractParameters,
            expirationTimestampInSec: new BigNumber(new Date(relayerLendOffer.expirationTime).getTime() / 1000),
            salt: new BigNumber(relayerLendOffer.salt || 0),
            debtorSignature: relayerLendOffer.debtorSignature ? JSON.parse(relayerLendOffer.debtorSignature) : null,
            relayer: relayerLendOffer.relayerAddress,
            relayerFee: new BigNumber(relayerLendOffer.relayerFee || 0),
            underwriter: relayerLendOffer.underwriterAddress,
            underwriterRiskRating: new BigNumber(relayerLendOffer.underwriterRiskRating || 0),
            underwriterFee: new BigNumber(relayerLendOffer.underwriterFee || 0),
            underwriterSignature: relayerLendOffer.underwriterSignature ? JSON.parse(relayerLendOffer.underwriterSignature) : null,
            creditor: relayerLendOffer.creditorAddress,
            creditorSignature: relayerLendOffer.creditorSignature ? JSON.parse(relayerLendOffer.creditorSignature) : null,
            creditorFee: new BigNumber(relayerLendOffer.creditorFee || 0),
        });

        const principal = TokenAmount.fromRaw(parsedOffer.principalAmount, parsedOffer.principalTokenSymbol);
        const lendOfferParams: MaxLTVData = {
            collateralTokenAddress: parsedOffer.collateralTokenAddress,
            collateralTokenIndex: parsedOffer.collateralTokenIndex,
            collateralTokenSymbol: parsedOffer.collateralTokenSymbol,
            creditorFee: parsedOffer.creditorFee,
            debtorFee: parsedOffer.debtorFee,
            expiresIn: new TimeInterval(0, 'hours'), // not used, expirationTimestampInSec is set directly
            interestRate: InterestRate.fromRaw(parsedOffer.interestRate),
            issuanceVersion: parsedOffer.issuanceVersion,
            kernelVersion: parsedOffer.kernelVersion,
            maxLTV: new BigNumber(relayerLendOffer.maxLtv),
            priceProvider: relayerLendOffer.signerAddress,
            principal,
            principalTokenAddress: parsedOffer.principalTokenAddress,
            principalTokenIndex: parsedOffer.principalTokenIndex,
            relayer: parsedOffer.relayer,
            relayerFee: TokenAmount.fromRaw(parsedOffer.relayerFee, parsedOffer.principalTokenSymbol),
            salt: parsedOffer.salt,
            termLength: new TimeInterval(parsedOffer.termLength.toNumber(), parsedOffer.amortizationUnit),
            termsContract: parsedOffer.termsContract,
        };

        const creditorValued: CreditorValues = {
            creditor: parsedOffer.creditor,
            creditorSignature: parsedOffer.creditorSignature,
            expirationTimestampInSec: parsedOffer.expirationTimestampInSec,
        };

        const result = new MaxLTVLoanOffer(
            this.creditorProxyAddress,
            new ProviderBridge(this.wallet.provider, this.wallet),
            lendOfferParams,
            creditorValued,
        );

        return {
            offer: result,
            principal,
            collateral: TokenAmount.fromRaw(new BigNumber(0), parsedOffer.collateralTokenSymbol),
        };
    }
}