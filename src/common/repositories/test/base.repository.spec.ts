import { BaseRepository } from '../base.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrisma } from '../../test/mock-prisma';

class ConcreteRepository extends BaseRepository<any> {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
  testPaginate(page?: number, limit?: number) {
    return this.paginate(page, limit);
  }
  testBuildMeta(total: number, page: number, limit: number) {
    return this.buildPaginationMeta(total, page, limit);
  }
  testBuildSearch(search: string | undefined, fields: string[]) {
    return this.buildSearchFilter(search, fields);
  }
}

describe('BaseRepository', () => {
  let repo: ConcreteRepository;

  beforeEach(() => {
    repo = new ConcreteRepository(createMockPrisma() as any);
  });

  describe('paginate', () => {
    it('should return default skip=0 take=20 for page 1', () => {
      expect(repo.testPaginate(1, 20)).toEqual({ skip: 0, take: 20 });
    });

    it('should calculate correct skip for page 3 limit 10', () => {
      expect(repo.testPaginate(3, 10)).toEqual({ skip: 20, take: 10 });
    });

    it('should clamp limit to maximum 100', () => {
      expect(repo.testPaginate(1, 200).take).toBe(100);
    });

    it('should clamp limit to minimum 1', () => {
      expect(repo.testPaginate(1, 0).take).toBe(1);
    });

    it('should default to page 1 if undefined', () => {
      expect(repo.testPaginate(undefined, 10)).toEqual({ skip: 0, take: 10 });
    });
  });

  describe('buildPaginationMeta', () => {
    it('should compute hasNextPage correctly', () => {
      const meta = repo.testBuildMeta(100, 1, 20);
      expect(meta.hasNextPage).toBe(true);
      expect(meta.hasPreviousPage).toBe(false);
      expect(meta.totalPages).toBe(5);
    });

    it('should compute last page correctly', () => {
      const meta = repo.testBuildMeta(100, 5, 20);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPreviousPage).toBe(true);
    });

    it('should handle single page result', () => {
      const meta = repo.testBuildMeta(5, 1, 20);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPreviousPage).toBe(false);
      expect(meta.totalPages).toBe(1);
    });

    it('should handle empty result', () => {
      const meta = repo.testBuildMeta(0, 1, 20);
      expect(meta.total).toBe(0);
      expect(meta.totalPages).toBe(0);
    });
  });

  describe('buildSearchFilter', () => {
    it('should return undefined for empty search', () => {
      expect(repo.testBuildSearch('', ['name'])).toBeUndefined();
      expect(repo.testBuildSearch(undefined, ['name'])).toBeUndefined();
      expect(repo.testBuildSearch('  ', ['name'])).toBeUndefined();
    });

    it('should build OR filter for multiple fields', () => {
      const filter = repo.testBuildSearch('Abidjan', ['city', 'name']);
      expect(filter).toEqual({
        OR: [
          { city: { contains: 'Abidjan', mode: 'insensitive' } },
          { name: { contains: 'Abidjan', mode: 'insensitive' } },
        ],
      });
    });
  });
});
