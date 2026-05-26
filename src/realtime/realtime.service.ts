import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { SocketEvent } from '@transpro/shared';

@Injectable()
export class RealtimeService {
  private server: Server;

  setServer(server: Server) {
    this.server = server;
  }

  // Émettre à tous les clients d'un voyage spécifique
  broadcastToTrip(tripId: string, event: SocketEvent, data: any) {
    if (!this.server) return;
    this.server.to(`trip:${tripId}`).emit(event, data);
  }

  // Émettre à tous les membres d'une compagnie
  broadcastToCompany(tenantId: string, event: SocketEvent, data: any) {
    if (!this.server) return;
    this.server.to(`company:${tenantId}`).emit(event, data);
  }

  // Émettre à un utilisateur spécifique
  sendToUser(userId: string, event: SocketEvent, data: any) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // Broadcast global (super admin)
  broadcastAll(event: SocketEvent, data: any) {
    if (!this.server) return;
    this.server.emit(event, data);
  }
}
