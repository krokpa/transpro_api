import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DevelopersService } from './developers.service';
import { RegisterDeveloperDto } from './dto/register-developer.dto';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Développeurs (inscription)')
@Controller({ path: 'developer', version: '1' })
export class DevelopersController {
  constructor(private readonly developers: DevelopersService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Inscription self-service d\'un développeur tiers' })
  register(@Body() dto: RegisterDeveloperDto) {
    return this.developers.register(dto);
  }
}
