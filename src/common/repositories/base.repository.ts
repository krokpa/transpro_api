import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult, PaginationQuery } from '@transpro/shared';

export interface IBaseRepository<T, CreateDto, UpdateDto> {
  findById(id: string): Promise<T | null>;
  findAll(query?: PaginationQuery): Promise<PaginatedResult<T>>;
  create(data: CreateDto): Promise<T>;
  update(id: string, data: UpdateDto): Promise<T>;
  delete(id: string): Promise<void>;
}

export abstract class BaseRepository<T> {
  constructor(protected readonly prisma: PrismaService) {}

  protected buildPaginationMeta(
    total: number,
    page: number,
    limit: number,
  ): PaginatedResult<T>['meta'] {
    const totalPages = Math.ceil(total / limit);
    return {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  protected paginate(page = 1, limit = 20): { skip: number; take: number } {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    return {
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    };
  }

  protected buildSearchFilter(
    search: string | undefined,
    fields: string[],
  ): object | undefined {
    if (!search?.trim()) return undefined;
    return {
      OR: fields.map((field) => ({
        [field]: { contains: search, mode: 'insensitive' },
      })),
    };
  }
}
