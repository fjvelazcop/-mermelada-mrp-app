import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {AppModuleId, ModulePermissions, SystemRole, SystemUser} from '../../core/models/erp.models';

interface ModuleConfigMeta {
  id: AppModuleId;
  name: string;
  icon: string;
  description: string;
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './settings.html',
})
export class Settings {
  public api = inject(ErpApiService);

  public activeSection = signal<'users' | 'roles' | 'simulator'>('users');

  // Modal / Form state for Users
  public showUserModal = signal<boolean>(false);
  public editingUserId = signal<string | null>(null);

  // Modal / Form state for Roles
  public showRoleModal = signal<boolean>(false);
  public selectedRoleIdForMatrix = signal<string>('supervisor_planta');

  // Metadata for all system modules
  public modulesList: ModuleConfigMeta[] = [
    {
      id: 'dashboard',
      name: 'Tablero Principal',
      icon: 'dashboard',
      description: 'Métricas clave, alertas de stock mínimo y cotización de divisas BCV/Paralelo.',
    },
    {
      id: 'inventory',
      name: 'Inventario & Materia Prima',
      icon: 'inventory_2',
      description: 'Gestión de pulpa, azúcar, pectina, frascos, tapas y kardex de entradas/salidas.',
    },
    {
      id: 'production',
      name: 'Producción & BOM',
      icon: 'precision_manufacturing',
      description: 'Recetas de marmitas, órdenes de fabricación Make-to-Order y cálculo de mermas.',
    },
    {
      id: 'costing',
      name: 'Costos & Precios (Estructura 20KG)',
      icon: 'calculate',
      description: 'Hoja de costos unitarios, márgenes de ganancia, absorción de inactividad y PDF.',
    },
    {
      id: 'sales',
      name: 'Ventas & Despachos',
      icon: 'point_of_sale',
      description: 'Pedidos de clientes, notas de entrega con transportista y generación de OPs.',
    },
    {
      id: 'payroll',
      name: 'Nómina Semanal',
      icon: 'groups',
      description: 'Registro de personal, pago semanal en USD/Bs. y costeo de semanas inactivas.',
    },
    {
      id: 'settings',
      name: 'Configuración & Permisología',
      icon: 'settings',
      description: 'Creación de usuarios, asignación de roles y matriz de permisos del sistema.',
    },
    {
      id: 'architecture',
      name: 'Arquitectura & Documentación',
      icon: 'menu_book',
      description: 'Guía técnica, trazabilidad HACCP/BPM y lineamientos del sistema.',
    },
  ];

  // User Reactive Form
  public userForm = new FormGroup({
    fullName: new FormControl('', {nonNullable: true, validators: [Validators.required, Validators.minLength(3)]}),
    username: new FormControl('', {nonNullable: true, validators: [Validators.required, Validators.pattern(/^[a-zA-Z0-9._-]+$/)]}),
    email: new FormControl('', {nonNullable: true, validators: [Validators.required, Validators.email]}),
    nationalId: new FormControl('', {nonNullable: true, validators: [Validators.required]}),
    roleId: new FormControl('operator', {nonNullable: true, validators: [Validators.required]}),
    department: new FormControl('Producción & Cocción', {nonNullable: true, validators: [Validators.required]}),
    status: new FormControl<'activo' | 'inactivo'>('activo', {nonNullable: true, validators: [Validators.required]}),
    avatarBg: new FormControl('bg-stone-900', {nonNullable: true}),
  });

  // Role Reactive Form
  public roleForm = new FormGroup({
    name: new FormControl('', {nonNullable: true, validators: [Validators.required, Validators.minLength(3)]}),
    description: new FormControl('', {nonNullable: true, validators: [Validators.required]}),
    color: new FormControl('amber', {nonNullable: true, validators: [Validators.required]}),
  });

  public selectedRoleForMatrix = computed<SystemRole | undefined>(() => {
    const roles = this.api.systemRoles();
    const id = this.selectedRoleIdForMatrix();
    return roles.find(r => r.id === id) || roles[0];
  });

  // Color options for roles & users
  public avatarColors = [
    {label: 'Carbón', value: 'bg-stone-900'},
    {label: 'Ámbar', value: 'bg-amber-600'},
    {label: 'Azul', value: 'bg-blue-600'},
    {label: 'Esmeralda', value: 'bg-emerald-600'},
    {label: 'Púrpura', value: 'bg-purple-600'},
    {label: 'Rojo', value: 'bg-rose-600'},
    {label: 'Índigo', value: 'bg-indigo-600'},
  ];

  public roleColors = [
    {label: 'Ámbar (Producción)', value: 'amber'},
    {label: 'Azul (Operaciones)', value: 'blue'},
    {label: 'Esmeralda (Finanzas)', value: 'emerald'},
    {label: 'Púrpura (Logística)', value: 'purple'},
    {label: 'Rojo (Supervisión)', value: 'rose'},
    {label: 'Gris Carbón (Admin)', value: 'stone'},
  ];

  public setSection(section: 'users' | 'roles' | 'simulator') {
    this.activeSection.set(section);
  }

  // --- USER ACTIONS ---
  public openCreateUserModal() {
    this.editingUserId.set(null);
    this.userForm.reset({
      fullName: '',
      username: '',
      email: '',
      nationalId: 'V-',
      roleId: this.api.systemRoles()[0]?.id || 'operator',
      department: 'Planta de Elaboración',
      status: 'activo',
      avatarBg: 'bg-stone-900',
    });
    this.showUserModal.set(true);
  }

  public openEditUserModal(user: SystemUser) {
    this.editingUserId.set(user.id);
    this.userForm.setValue({
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      nationalId: user.nationalId,
      roleId: user.roleId,
      department: user.department,
      status: user.status,
      avatarBg: user.avatarBg || 'bg-stone-900',
    });
    this.showUserModal.set(true);
  }

  public closeUserModal() {
    this.showUserModal.set(false);
    this.editingUserId.set(null);
  }

  public saveUser() {
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }
    const formVal = this.userForm.getRawValue();
    const editingId = this.editingUserId();

    if (editingId) {
      this.api.updateUser(editingId, formVal);
    } else {
      this.api.addUser({
        fullName: formVal.fullName,
        username: formVal.username.toLowerCase(),
        email: formVal.email,
        nationalId: formVal.nationalId,
        roleId: formVal.roleId,
        roleName: '',
        department: formVal.department,
        status: formVal.status,
        avatarBg: formVal.avatarBg,
      });
    }
    this.closeUserModal();
  }

  public toggleUserStatus(user: SystemUser) {
    const newStatus = user.status === 'activo' ? 'inactivo' : 'activo';
    this.api.updateUser(user.id, {status: newStatus});
  }

  public deleteUser(user: SystemUser) {
    if (confirm(`¿Estás seguro de eliminar al usuario "${user.fullName}" (${user.username})?`)) {
      this.api.deleteUser(user.id);
    }
  }

  public simulateUser(user: SystemUser) {
    this.api.setActiveUser(user.id);
  }

  // --- ROLE & PERMISSION ACTIONS ---
  public openCreateRoleModal() {
    this.roleForm.reset({
      name: '',
      description: '',
      color: 'amber',
    });
    this.showRoleModal.set(true);
  }

  public closeRoleModal() {
    this.showRoleModal.set(false);
  }

  public saveRole() {
    if (this.roleForm.invalid) {
      this.roleForm.markAllAsTouched();
      return;
    }
    const val = this.roleForm.getRawValue();

    // Default permissions for new role (view only dashboard by default)
    const defaultPerms: Record<AppModuleId, ModulePermissions> = {
      dashboard: {canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false},
      inventory: {canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false},
      production: {canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false},
      costing: {canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false},
      sales: {canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false},
      payroll: {canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false},
      settings: {canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false},
      architecture: {canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false},
    };

    const newRole = this.api.addRole({
      name: val.name,
      description: val.description,
      color: val.color,
      permissions: defaultPerms,
    });
    this.selectedRoleIdForMatrix.set(newRole.id);
    this.closeRoleModal();
  }

  public togglePermission(roleId: string, moduleId: AppModuleId, action: keyof ModulePermissions) {
    const role = this.api.systemRoles().find(r => r.id === roleId);
    if (!role) return;
    if (role.id === 'admin') {
      this.api.showToast('El rol Administrador General tiene permisos absolutos y no puede ser restringido.', 'info');
      return;
    }
    const currentPerm = role.permissions[moduleId] || {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
    };
    const newVal = !currentPerm[action];

    // If granting create/edit/delete/export, automatically grant canView
    const updatedPerm: Partial<ModulePermissions> = {[action]: newVal};
    if (newVal && action !== 'canView') {
      updatedPerm.canView = true;
    }
    // If revoking canView, also revoke other actions
    if (!newVal && action === 'canView') {
      updatedPerm.canCreate = false;
      updatedPerm.canEdit = false;
      updatedPerm.canDelete = false;
      updatedPerm.canExport = false;
    }

    this.api.updateRolePermissions(roleId, moduleId, updatedPerm);
  }

  public toggleAllModulePermissions(roleId: string, moduleId: AppModuleId, enable: boolean) {
    const role = this.api.systemRoles().find(r => r.id === roleId);
    if (!role || role.id === 'admin') return;

    this.api.updateRolePermissions(roleId, moduleId, {
      canView: enable,
      canCreate: enable,
      canEdit: enable,
      canDelete: enable,
      canExport: enable,
    });
  }

  public getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
}
