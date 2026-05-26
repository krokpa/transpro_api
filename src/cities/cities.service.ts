import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCityDto, UpdateCityDto } from './dto/city.dto';

const CI_CITIES = [
  { name: 'Abidjan',       region: 'Lagunes',         code: 'ABJ' },
  { name: 'Bouaké',        region: 'Vallée du Bandama', code: 'BKE' },
  { name: 'Yamoussoukro',  region: 'Lacs',             code: 'YMK' },
  { name: 'Gagnoa',        region: 'Fromager',         code: 'GGN' },
  { name: 'San-Pédro',     region: 'Bas-Sassandra',    code: 'SPD' },
  { name: 'Daloa',         region: 'Haut-Sassandra',   code: 'DLO' },
  { name: 'Korhogo',       region: 'Poro',             code: 'KRH' },
  { name: 'Man',           region: 'Tonkpi',           code: 'MAN' },
  { name: 'Divo',          region: 'Lôh-Djiboua',      code: 'DVO' },
  { name: 'Abengourou',    region: 'Indénié-Djuablin', code: 'ABG' },
  { name: 'Bondoukou',     region: 'Gontougo',         code: 'BDK' },
  { name: 'Odienné',       region: 'Kabadougou',       code: 'ODN' },
  { name: 'Tabou',         region: 'San-Pédro',        code: 'TAB' },
  { name: 'Grand-Bassam',  region: 'Sud-Comoé',        code: 'GBS' },
  { name: 'Agboville',     region: 'Agnéby-Tiassa',    code: 'AGB' },
  { name: 'Aboisso',       region: 'Sud-Comoé',        code: 'ABS' },
  { name: 'Adzopé',        region: 'La Mé',            code: 'AZP' },
  { name: 'Dimbokro',      region: 'Iffou',            code: 'DIM' },
  { name: 'Ferkessédougou',region: 'Hambol',           code: 'FRK' },
  { name: 'Sassandra',     region: 'Gbôklé',           code: 'SSD' },
  { name: 'Soubré',        region: 'Nawa',             code: 'SBR' },
  { name: 'Toumodi',       region: 'Lacs',             code: 'TMD' },
  { name: 'Bongouanou',    region: 'Moronou',          code: 'BGO' },
  { name: 'Tiassalé',      region: 'Agnéby-Tiassa',    code: 'TSL' },
  { name: 'Issia',         region: 'Haut-Sassandra',   code: 'ISS' },
  { name: 'Katiola',       region: 'Hambol',           code: 'KTL' },
  { name: 'Séguéla',       region: 'Worodougou',       code: 'SGL' },
  { name: 'Sinfra',        region: 'Marahoué',         code: 'SFR' },
  { name: 'Zuénoula',      region: 'Marahoué',         code: 'ZNL' },
  { name: 'Mankono',       region: 'Bafing',           code: 'MNK' },
  { name: 'Tengréla',      region: 'Bagoué',           code: 'TGR' },
  { name: 'Boundiali',     region: 'Bagoué',           code: 'BDL' },
  { name: 'Minignan',      region: 'Folon',            code: 'MNG' },
];

@Injectable()
export class CitiesService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    const count = await this.prisma.city.count();
    if (count === 0) {
      await this.prisma.city.createMany({ data: CI_CITIES, skipDuplicates: true });
    }
  }

  async findAll(search?: string) {
    return this.prisma.city.findMany({
      where: {
        isActive: true,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, region: true, code: true },
    });
  }

  async findOne(id: string) {
    const city = await this.prisma.city.findUnique({ where: { id } });
    if (!city) throw new NotFoundException('Ville introuvable');
    return city;
  }

  async create(dto: CreateCityDto) {
    return this.prisma.city.create({ data: dto });
  }

  async update(id: string, dto: UpdateCityDto) {
    await this.findOne(id);
    return this.prisma.city.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.city.update({ where: { id }, data: { isActive: false } });
  }
}
