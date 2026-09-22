declare namespace Express {
  export interface Request {
    user?: {
      sub: string
      role: string
      clientId?: string
      providerCode?: string
      portalRole?: string
    }
  }
}
