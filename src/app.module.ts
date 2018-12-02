import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TokenService } from './token.service';
import { ethers } from 'ethers';
import { TokenMetadata } from './token.entity';

const provider = ethers.getDefaultProvider('rinkeby');
const privateKey = require('../resources/account.json').privateKey;
const wallet = new ethers.Wallet(privateKey, provider);

const walletProvider = {
    provide: 'wallet',
    useValue: wallet,
};

const tokens: TokenMetadata[] = require('../resources/tonens.json');
const tokensProvider = {
    provide: 'tokens',
    useValue: tokens,
};

@Module({
    imports: [],
    controllers: [AppController],
    providers: [AppService, TokenService, walletProvider, tokensProvider],
})
export class AppModule { }
