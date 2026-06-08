import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketEvent } from '@transpro/shared';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/',
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private realtime: RealtimeService,
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.realtime.setServer(server);
    this.logger.log('WebSocket Gateway initialisé');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];

      if (token) {
        const payload = this.jwt.verify(token, {
          secret: this.config.get('JWT_SECRET'),
        });
        client.data.user = payload;

        // Rejoindre automatiquement la room utilisateur
        client.join(`user:${payload.sub}`);

        // Si membre d'une compagnie, rejoindre la room compagnie
        if (payload.tenantId) {
          client.join(`company:${payload.tenantId}`);
        }

        this.logger.debug(`Client connecté: ${payload.sub} (${payload.role})`);
      }
    } catch {
      // Connexion anonyme — accès limité aux rooms publiques
      this.logger.debug(`Client anonyme connecté: ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client déconnecté: ${client.id}`);
  }

  // Rejoindre la room d'un voyage (pour voir les sièges en temps réel)
  @SubscribeMessage(SocketEvent.JOIN_TRIP_ROOM)
  handleJoinTrip(@ConnectedSocket() client: Socket, @MessageBody() data: { tripId: string }) {
    client.join(`trip:${data.tripId}`);
    this.logger.debug(`${client.id} a rejoint trip:${data.tripId}`);
    return { event: 'joined', data: `trip:${data.tripId}` };
  }

  @SubscribeMessage(SocketEvent.LEAVE_TRIP_ROOM)
  handleLeaveTrip(@ConnectedSocket() client: Socket, @MessageBody() data: { tripId: string }) {
    client.leave(`trip:${data.tripId}`);
    return { event: 'left', data: `trip:${data.tripId}` };
  }

  // Driver broadcasts its GPS position → server validates, persists, fans out to all trip watchers.
  @SubscribeMessage(SocketEvent.LOCATION_UPDATE)
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tripId: string; lat: number; lng: number; heading?: number; speed?: number },
  ) {
    if (!data?.tripId || data.lat == null || data.lng == null) return;

    const user = client.data.user;

    // Valider que l'émetteur est bien le chauffeur assigné à ce voyage
    if (user?.driverId) {
      const trip = await this.prisma.trip.findFirst({
        where: { id: data.tripId, driverId: user.driverId },
        select: { id: true },
      });
      if (!trip) {
        this.logger.warn(`Location rejetée : driverId=${user.driverId} non assigné au trip=${data.tripId}`);
        return;
      }
    } else if (user?.role && !['COMPANY_AGENT', 'COMPANY_OWNER', 'COMPANY_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      // Rejeter si le rôle n'est pas autorisé à émettre une position
      return;
    }

    const payload = {
      tripId:  data.tripId,
      lat:     data.lat,
      lng:     data.lng,
      heading: data.heading ?? 0,
      speed:   data.speed   ?? 0,
      ts:      Date.now(),
    };

    // Persister la dernière position connue (non-bloquant)
    this.prisma.trip.updateMany({
      where: { id: data.tripId },
      data: {
        currentLat:        data.lat,
        currentLng:        data.lng,
        currentHeading:    data.heading ?? 0,
        currentSpeed:      data.speed   ?? 0,
        locationUpdatedAt: new Date(),
      },
    }).catch(() => {});

    // Broadcaster à tous les observateurs du voyage
    this.server.to(`trip:${data.tripId}`).emit(SocketEvent.BUS_LOCATION, payload);
  }

  @SubscribeMessage(SocketEvent.JOIN_COMPANY_ROOM)
  handleJoinCompany(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tenantId: string },
  ) {
    const user = client.data.user;
    if (!user || user.tenantId !== data.tenantId) return { error: 'Non autorisé' };

    client.join(`company:${data.tenantId}`);
    return { event: 'joined', data: `company:${data.tenantId}` };
  }
}
