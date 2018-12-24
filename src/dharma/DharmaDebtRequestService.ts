import { Injectable, Inject } from '@nestjs/common';
import { Address } from 'src/types';
import { Wallet } from 'ethers';
import { CollateralizedSimpleInterestLoanAdapter } from './CollateralizedSimpleInterestLoanAdapter';
import { TokenSymbol } from '../tokens/TokenSymbol';
import { TransactionLog } from '../TransactionLog';
import { TokenService } from '../tokens/TokenService';
import { Logger } from 'winston';
import { DharmaOrdersFetcher } from './DharmaOrdersFetcher';
import { Status } from './models/RelayerDebtOrder';
import { DebtOrderWrapper } from './wrappers/DebtOrderWrapper';

@Injectable()
export class DharmaDebtRequestService {

    constructor(
        @Inject('wallet') private readonly wallet: Wallet,
        @Inject('token-transfer-proxy-address') private readonly tokenTransferProxyAddress: Address,
        @Inject('winston') private readonly logger: Logger,
        private readonly ordersFetcher: DharmaOrdersFetcher,
        private readonly tokenService: TokenService,
        private readonly loanAdapter: CollateralizedSimpleInterestLoanAdapter,
        private readonly debtOrderWrapper: DebtOrderWrapper,
    ) { }

    async getDebtOrders(
        principalTokenSymbol?: TokenSymbol, collateralTokenSymbol?: TokenSymbol, minUsdAmount?: number, maxUsdAmount?: number,
    ): Promise<any[]> {
        const res = await this.ordersFetcher.fetchOrders(
            Status.SignedByDebtor,
            principalTokenSymbol,
            collateralTokenSymbol,
            minUsdAmount,
            maxUsdAmount,
        );

        const humanReadableResponse = await Promise.all(res.map(relayerOrder =>
            this.loanAdapter.fromRelayerDebtOrder(relayerOrder)
                .then(x => ({
                    id: relayerOrder.id,
                    principal: x.principal.toString(),
                    collateral: x.collateral.toString(),
                    interestRate: x.interestRate.toNumber() / 100,
                    termLength: x.termLength.toNumber(),
                    amortizationUnit: x.amortizationUnit,
                })),
        ));

        return humanReadableResponse;
    }

    async fillDebtRequest(requestId: string, needAwaitMining: boolean): Promise<TransactionLog> {
        const transactions = new TransactionLog();
        const rawOrder = await this.ordersFetcher.fetchOrder(requestId);
        const order = await this.loanAdapter.fromRelayerDebtOrder(rawOrder);

        await this.tokenService.addUnlockTransactionIfNeeded(order.principal.token.symbol, this.tokenTransferProxyAddress, transactions);

        order.creditor = this.wallet.address;
        const tx = await this.debtOrderWrapper.wrapDebtOrder(order).fill({ nonce: transactions.getNextNonce() });

        this.logger.info(`Filling debt request with id ${requestId}`);
        this.logger.info(`tx hash: ${tx.hash}`);

        transactions.add({
            name: 'fillDebtRequest',
            transactionObject: tx,
        });

        if (needAwaitMining) {
            await transactions.wait();
        }

        return transactions;
    }
}
