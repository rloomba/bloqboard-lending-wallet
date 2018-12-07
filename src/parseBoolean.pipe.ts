import { Injectable, PipeTransform, ArgumentMetadata, BadRequestException } from '@nestjs/common';

@Injectable()
export class ParseBooleanPipe implements PipeTransform<string> {
    async transform(value: string, metadata: ArgumentMetadata): Promise<boolean> {
        const isBoolean =
            'string' === typeof value &&
            (value === 'false' || value === 'true');
        if (!isBoolean) {
            throw new BadRequestException(
                'Validation failed (numeric string is expected)',
            );
        }
        return JSON.parse(value);
    }
}