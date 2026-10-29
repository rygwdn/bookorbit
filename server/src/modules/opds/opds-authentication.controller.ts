import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { opdsAuthenticationDocument } from './opds-http';

@Controller('opds/authentication')
@Public()
export class OpdsAuthenticationController {
  @Get()
  @Header('Content-Type', 'application/opds-authentication+json')
  get() {
    return opdsAuthenticationDocument();
  }
}
