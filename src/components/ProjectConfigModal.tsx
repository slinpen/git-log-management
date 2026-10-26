import { useEffect, useState } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Space, Button, message, Typography, Tag, Alert, Tooltip } from 'antd';
import { PlusOutlined, MinusCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { Project, ProjectConfig, DetectedConfig } from '../types';
import { api } from '../api';

interface Props {
  project: Project;
  open: boolean;
  onClose: () => void;
  onSaved: (config: ProjectConfig) => void;
}

const FRAMEWORK_LABELS: Record<string, string> = {
  vite: 'Vite', next: 'Next.js', nuxt: 'Nuxt', nest: 'NestJS',
  express: 'Express', cra: 'Create React App', angular: 'Angular', unknown: '未知',
};

export default function ProjectConfigModal({ project, open, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // 优先用已加载的 project.config，否则请求接口
    if (project.config) {
      form.setFieldsValue({
        startCommand: project.config.startCommand || '',
        port: project.config.port ?? undefined,
        cwd: project.config.cwd || '',
        autoOpen: project.config.autoOpen ?? false,
        envList: Object.entries(project.config.env || {}).map(([key, value]) => ({ key, value })),
      });
      setLoading(false);
    } else {
      api.getProjectConfig(project.id).then((d) => {
        if (d.ok && d.config) {
          form.setFieldsValue({
            startCommand: d.config.startCommand || '',
            port: d.config.port ?? undefined,
            cwd: d.config.cwd || '',
            autoOpen: d.config.autoOpen ?? false,
            envList: Object.entries(d.config.env || {}).map(([key, value]) => ({ key, value })),
          });
        }
      }).finally(() => setLoading(false));
    }
  }, [open, project.id, project.config, form]);

  // 自动解析项目配置
  const handleDetect = async () => {
    setDetecting(true);
    setDetected(null);
    try {
      const d = await api.detectProjectConfig(project.id);
      if (!d.ok) {
        message.error(d.error || '解析失败');
        return;
      }
      setDetected(d.detected);
      if (d.detected.startCommand) {
        form.setFieldsValue({ startCommand: d.detected.startCommand });
      }
      if (d.detected.port) {
        form.setFieldsValue({ port: d.detected.port });
      }
      if (d.detected.packageJsonFound) {
        message.success('已自动解析并填充配置');
      } else {
        message.warning(d.detected.note || '未找到 package.json');
      }
    } catch (e) {
      message.error('解析失败');
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const env: Record<string, string> = {};
      for (const item of values.envList || []) {
        if (item.key && item.key.trim()) env[item.key.trim()] = item.value || '';
      }
      const config: Partial<ProjectConfig> = {
        startCommand: (values.startCommand || '').trim(),
        port: values.port ?? null,
        cwd: (values.cwd || '').trim(),
        autoOpen: !!values.autoOpen,
        env,
      };
      const d = await api.saveProjectConfig(project.id, config);
      if (d.ok) {
        message.success('配置已保存');
        onSaved(d.config);
        onClose();
      } else {
        message.error(d.error || '保存失败');
      }
    } catch (e: any) {
      if (e?.errorFields) return; // 校验失败，Form 已提示
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`运行配置 · ${project.name}`}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      width={560}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        {/* 自动解析 */}
        <div style={{ marginBottom: 16 }}>
          <Button
            icon={<ThunderboltOutlined />}
            loading={detecting}
            onClick={handleDetect}
            block
          >
            自动解析项目配置（读取 package.json / vite.config / .env）
          </Button>
          {detected && detected.packageJsonFound && (
            <div style={{ marginTop: 8 }}>
              <Space size={4} wrap>
                <Tag color="blue">{FRAMEWORK_LABELS[detected.framework] || detected.framework}</Tag>
                <Tag color="purple">{detected.packageManager}</Tag>
                {detected.script && <Tag color="cyan">脚本：{detected.script.name}</Tag>}
                {detected.port && <Tag color="green">端口：{detected.port}</Tag>}
              </Space>
            </div>
          )}
          {detected && !detected.packageJsonFound && (
            <Alert type="warning" message={detected.note || '未找到 package.json'} style={{ marginTop: 8 }} showIcon />
          )}
        </div>

        <Form.Item
          name="startCommand"
          label="启动命令"
          rules={[{ required: true, message: '请填写启动命令' }]}
        >
          <Input placeholder="如 npm run dev / yarn dev / pnpm start" />
        </Form.Item>

        <Space size={16} style={{ display: 'flex' }} align="start">
          <Form.Item name="port" label="访问端口" style={{ flex: 1 }}>
            <InputNumber placeholder="如 5173" min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="cwd" label="工作目录（可选，默认项目根目录）" style={{ flex: 2 }}>
            <Input placeholder="如 packages/web，留空用项目根目录" />
          </Form.Item>
        </Space>

        <Form.Item name="autoOpen" label="启动成功后自动打开浏览器" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>环境变量（可选）</Typography.Text>
        <Form.List name="envList">
          {(fields, { add, remove }) => (
            <div style={{ marginTop: 8 }}>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                  <Form.Item {...rest} name={[name, 'key']} style={{ marginBottom: 0 }}>
                    <Input placeholder="变量名，如 NODE_ENV" style={{ width: 200 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, 'value']} style={{ marginBottom: 0 }}>
                    <Input placeholder="值，如 development" style={{ width: 220 }} />
                  </Form.Item>
                  <MinusCircleOutlined onClick={() => remove(name)} />
                </Space>
              ))}
              <Button type="dashed" onClick={() => add({ key: '', value: '' })} icon={<PlusOutlined />} block>
                添加环境变量
              </Button>
            </div>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
